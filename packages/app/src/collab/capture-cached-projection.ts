import { DOCUMENT_LAYOUT_VERSION } from '@canvas/document';
import {
  isPreviewCertificate,
  isSameCamera,
  isVirtualObjectId,
  visibleWorldBounds,
  type EngineHost,
} from '@canvas/engine';
import { createBoard, exportBoard, type Board, type BoardObject } from '@canvas/schema';

import { readHostSceneStamp } from '../engine/host-scene-stream.js';

import type { CachedProjectionIdentity } from './cached-projection.js';
import { candidateOwners, definitionClosure, projectionAssetIds } from './instance-projection.js';
import { previewObjects } from './preview-objects.js';

/** Immutable authoritative source paired with the renderer revision, excluding tool previews. */
export interface ProjectionCapture extends CachedProjectionIdentity {
  /** Captured authoritative plain objects, never a mutable store view. */
  readonly board: Board;
  /**
   * The whole board's immutable snapshot, pages included, that shown instances resolve against
   * (ruling 9): their mains may be on another page or retired. Absent: `board`.
   */
  readonly definitions?: Board;
  /** False after any source, camera, eligibility or lifetime change, including tool previews. */
  readonly isCurrent: () => boolean;
}

/**
 * Prepares an optional sidecar; the cache binding still owns atomic snapshot publication.
 *
 * @param host - The rendering host with a stamped stream.
 * @param capture - Immutable authoritative source and its live eligibility fence.
 * @returns Bytes for atomic compaction, or undefined when evidence is unavailable or changed.
 * @throws {Error} When the host rejects its certificate read; the cache binding reports and falls back.
 */
export function captureCachedProjection(
  host: EngineHost,
  capture: ProjectionCapture,
): Promise<Uint8Array | undefined> {
  return captureProjection(host, capture, () => true);
}

/**
 * Captures with renderer evidence; `accepts` may refuse the assembled projection's objects.
 *
 * @param host - The rendering host with a stamped stream.
 * @param capture - Immutable authoritative source and its live eligibility fence.
 * @param accepts - Whether the projection's objects may be stored.
 * @returns Sidecar bytes, or undefined.
 */
async function captureProjection(
  host: EngineHost,
  capture: ProjectionCapture,
  accepts: (objects: readonly BoardObject[]) => boolean,
): Promise<Uint8Array | undefined> {
  const scene = readHostSceneStamp(host);
  if (scene === undefined || !capture.isCurrent()) return undefined;
  const camera = { ...capture.camera };
  const request = {
    scene,
    camera,
    coverage: visibleWorldBounds(camera),
    fontSetKey: capture.fontSetKey,
  };
  const certificate = await host.readPreviewCertificate?.(request);
  const current = readHostSceneStamp(host);
  if (
    !capture.isCurrent() ||
    current?.session !== scene.session ||
    current.sequence !== scene.sequence ||
    !isPreviewCertificate(certificate) ||
    certificate.scene.session !== scene.session ||
    certificate.scene.sequence !== scene.sequence ||
    certificate.fontSetKey !== capture.fontSetKey ||
    !isSameCamera(certificate.camera, camera)
  )
    return undefined;
  // A virtual instance descendant is stored as its owner and never persisted (ruling 9).
  const isExpanded = certificate.candidates.some(isVirtualObjectId);
  const candidates = isExpanded ? candidateOwners(certificate.candidates) : certificate.candidates;
  const objects = previewObjects(capture.board.objects, candidates);
  if (objects === undefined) return undefined;
  const definitions = capture.definitions ?? capture.board;
  const closure = definitionClosure(definitions, objects);
  const projection = closure.length === 0 ? objects : [...objects, ...closure];
  if (!accepts(projection)) return undefined;
  if (closure.length > 0) {
    const certified = new Set(certificate.assets.map((asset) => asset.assetId));
    for (const assetId of projectionAssetIds(projection))
      if (!certified.has(assetId)) return undefined;
  }
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      format: 'canvas.cached-projection',
      version: 1,
      boardId: capture.boardId,
      layoutVersion: DOCUMENT_LAYOUT_VERSION,
      certificate: isExpanded ? { ...certificate, candidates } : certificate,
      projection: exportBoard(
        closure.length === 0
          ? createBoard(objects)
          : createBoard(projection, definitions.pages?.values()),
      ),
    }),
  );
  return capture.isCurrent() && bytes.byteLength <= 128 * 1024 * 1024 ? bytes : undefined;
}

/**
 * Rejects incomplete live sources and image provenance before requesting a display sidecar.
 *
 * @param host - The current renderer, absent before startup.
 * @param source - Immutable document objects, absent during tool overrides.
 * @param identity - Current board, camera and font evidence with its mount lifetime fence.
 * @param identity.boardId - Authorized board.
 * @param identity.fontSetKey - Current font bytes.
 * @param identity.camera - Current viewport.
 * @param identity.isCurrent - Live camera and mount fence.
 * @returns Optional image-free display bytes.
 */
export function captureLiveProjection(
  host: EngineHost | undefined,
  source: Pick<ProjectionCapture, 'board' | 'definitions' | 'isCurrent'> | undefined,
  identity: {
    readonly boardId: string;
    readonly fontSetKey: string | undefined;
    readonly camera: ProjectionCapture['camera'];
    readonly isCurrent: (camera: ProjectionCapture['camera']) => boolean;
  },
): Promise<Uint8Array | undefined> {
  if (
    host === undefined ||
    source === undefined ||
    identity.fontSetKey === undefined ||
    [...source.board.objects.values()].some((object) => object.type === 'image')
  )
    return Promise.resolve(undefined);
  return captureProjection(
    host,
    {
      ...source,
      ...identity,
      fontSetKey: identity.fontSetKey,
      isCurrent: () => source.isCurrent() && identity.isCurrent(identity.camera),
    },
    // A shown instance's main closure, wherever it is, is held to the same image-free rule.
    (objects) => projectionAssetIds(objects).size === 0,
  );
}
