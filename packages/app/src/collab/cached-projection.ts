import { DOCUMENT_LAYOUT_VERSION } from '@canvas/document';
import {
  isPreviewCertificate,
  isSameCamera,
  visibleWorldBounds,
  type Camera,
  type PreviewCertificate,
} from '@canvas/engine';
import { importBoard, SCHEMA_VERSION, type Board, type ObjectId } from '@canvas/schema';

import { definitionClosure, projectionAssetIds } from './instance-projection.js';
import { previewObjects } from './preview-objects.js';

/** Reopen identity established by authenticated startup, before any cached content is drawn. */
export interface CachedProjectionIdentity {
  /** Authorized board; caller must authenticate before using the returned content. */
  readonly boardId: string;
  /** Current immutable font-content identity. */
  readonly fontSetKey: string;
  /** Frozen viewport that will be shown until hydration finishes. */
  readonly camera: Camera;
}

/** Reopen may restore the certified camera, but never a different viewport or font set. */
export type CachedProjectionReadIdentity =
  | CachedProjectionIdentity
  | {
      readonly boardId: string;
      readonly fontSetKey: string;
      readonly viewport: Pick<Camera, 'viewportWidthPx' | 'viewportHeightPx' | 'dpr'>;
    };

/** Validated data only: resource identities still require verification at the new mount. */
export interface CachedProjection {
  /** Owned objects with validated ids, fields, references and geometry bounds. */
  readonly board: Board;
  /**
   * The objects that draw: the certified candidates and their ancestors. The rest only define
   * shown instances (ruling 9: mains on another page, retired mains, their content).
   * Absent: every object draws. `prepareCachedProjection` always sets it.
   */
  readonly shownIds?: ReadonlySet<ObjectId>;
  /** Evidence for the previous mount, never a current renderer acknowledgement. */
  readonly certificate: PreviewCertificate;
}

/**
 * Reads an optional current-layout sidecar without hydrating or modifying authoritative bytes.
 * A successful read is not permission to display: startup must authenticate and verify current
 * assets, image/LOD plans and renderer resources against this previous-frame certificate.
 *
 * @param bytes - Cached JSON bytes, kept intact on every failure.
 * @param expected - Authorized board and exact new-mount font/viewport identity.
 * @returns Owned preview data, or undefined for malformed, stale or incompatible content.
 */
export function readCachedProjection(
  bytes: Uint8Array,
  expected: CachedProjectionReadIdentity,
): CachedProjection | undefined {
  return prepareCachedProjection(bytes, expected)?.accept(expected.fontSetKey);
}

/** Parsed projection whose fonts still need current-byte verification before use. */
export interface PendingCachedProjection {
  /** Historical font identity, used only to request known catalogue resources. */
  readonly fontSetKey: string;
  /** Returns the projection only if current font bytes exactly match the saved identity. */
  readonly accept: (fontSetKey: string | undefined) => CachedProjection | undefined;
}

/**
 * Validates a sidecar before its font files are available, without exposing drawable objects.
 *
 * @param bytes - Optional cache bytes; never modified.
 * @param expected - Authorized board and exact viewport or camera.
 * @returns A pending projection; accepting it still requires current font identity and fresh rendering proof.
 */
export function prepareCachedProjection(
  bytes: Uint8Array,
  expected:
    | Omit<CachedProjectionIdentity, 'fontSetKey'>
    | {
        readonly boardId: string;
        readonly viewport: Pick<Camera, 'viewportWidthPx' | 'viewportHeightPx' | 'dpr'>;
      },
): PendingCachedProjection | undefined {
  // Sidecars are optional. Bound parsing allocation before trusting their structure.
  if (bytes.byteLength === 0 || bytes.byteLength > 128 * 1024 * 1024) return undefined;
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const envelope = value as Record<string, unknown>;
    if (
      envelope.format !== 'canvas.cached-projection' ||
      envelope.version !== 1 ||
      envelope.boardId !== expected.boardId ||
      envelope.layoutVersion !== DOCUMENT_LAYOUT_VERSION
    )
      return undefined;
    const certificate = envelope.certificate;
    if (
      !isPreviewCertificate(certificate) ||
      !('camera' in expected
        ? isSameCamera(certificate.camera, expected.camera)
        : certificate.camera.viewportWidthPx === expected.viewport.viewportWidthPx &&
          certificate.camera.viewportHeightPx === expected.viewport.viewportHeightPx &&
          certificate.camera.dpr === expected.viewport.dpr)
    )
      return undefined;
    const viewport = visibleWorldBounds(certificate.camera);
    const coverage = certificate.coverage;
    if (
      coverage.minX > viewport.minX ||
      coverage.minY > viewport.minY ||
      coverage.maxX < viewport.maxX ||
      coverage.maxY < viewport.maxY
    )
      return undefined;
    const projection = envelope.projection;
    // Never migrate a display-only sidecar. The authoritative snapshot owns migration.
    if (
      typeof projection !== 'object' ||
      projection === null ||
      !('schemaVersion' in projection) ||
      projection.schemaVersion !== SCHEMA_VERSION
    )
      return undefined;
    const board = importBoard(projection);
    // Stored candidates are real ids only; a virtual one fails here (ruling 9).
    const candidates = previewObjects(board.objects, certificate.candidates);
    if (candidates === undefined) return undefined;
    // Every other object must be in a shown instance's main closure; none without instances.
    const closure = definitionClosure(board, candidates);
    if (candidates.length + closure.length !== board.objects.size) return undefined;
    const assets = new Set(certificate.assets.map((asset) => asset.assetId));
    for (const assetId of projectionAssetIds(board.objects.values())) {
      if (!assets.has(assetId)) return undefined;
    }
    const shownIds = new Set(candidates.map((object) => object.id));
    return {
      fontSetKey: certificate.fontSetKey,
      accept: (fontSetKey) =>
        fontSetKey === certificate.fontSetKey ? { board, shownIds, certificate } : undefined,
    };
  } catch {
    return undefined;
  }
}
