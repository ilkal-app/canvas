import type { ObjectId } from '@canvas/schema';

import type { Camera, WorldBounds } from '../camera/camera.js';

import { isProjectionBounds } from './scene-projection.js';

/** App-owned document identity for one mounted engine; never a snapshot hash. */
export interface SceneStamp {
  /** Nonempty mount identifier, at most 128 characters. */
  readonly session: string;
  /** Contiguous batch sequence beginning at zero; a nonnegative safe integer. */
  readonly sequence: number;
}

/** App's requested scene/camera and immutable font identity at a drawn frame. */
export interface PreviewRequest {
  /** Exact applied document stream revision. */
  readonly scene: SceneStamp;
  /** Actual camera whose frame must be certified. */
  readonly camera: Camera;
  /** Candidate coverage in world units. */
  readonly coverage: WorldBounds;
  /** Expected immutable font content set; face names alone are insufficient. */
  readonly fontSetKey: string;
}

/** Immutable original and rendition content required by a certified frame. */
export interface PreviewAssetVersion {
  /** App asset identifier. */
  readonly assetId: string;
  /** Verified complete source-content version, including rendition selectors. */
  readonly contentVersion: string;
}

/** A complete frame certificate, issued only with every installed resource contributor. */
export interface PreviewCertificate extends PreviewRequest {
  /** Complete spatial candidates at the certified frame. */
  readonly candidates: readonly ObjectId[];
  /** Immutable complete source-content identities for every required asset. */
  readonly assets: readonly PreviewAssetVersion[];
  /** Exact reusable image plan, excluding renderer-local allocation handles. */
  readonly imagePlanKey: string;
  /** Exact non-full LOD forms, including hysteresis choices. */
  readonly lodPlanKey: string;
  /** The runtime frame this evidence describes. */
  readonly frameIndex: number;
  /** Resource generation at that frame, not a guarantee about subsequent frames. */
  readonly resourceGeneration: number;
}

/**
 * Checks an opaque mount stamp before queueing or accepting protocol data.
 *
 * @param value - Proposed stamp.
 * @returns Whether it has a bounded session and a nonnegative safe sequence.
 */
export function isSceneStamp(value: unknown): value is SceneStamp {
  if (typeof value !== 'object' || value === null) return false;
  const stamp = value as Partial<SceneStamp>;
  return (
    typeof stamp.session === 'string' &&
    stamp.session.length > 0 &&
    stamp.session.length <= 128 &&
    typeof stamp.sequence === 'number' &&
    Number.isSafeInteger(stamp.sequence) &&
    stamp.sequence >= 0
  );
}

/**
 * Checks a certificate request without accepting nonfinite camera or coverage values.
 *
 * @param value - Proposed request.
 * @returns Whether it can be queued safely by either host.
 */
export function isPreviewRequest(value: unknown): value is PreviewRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Partial<Omit<PreviewRequest, 'camera' | 'coverage'>> & {
    camera?: Camera | null;
    coverage?: WorldBounds | null;
  };
  const camera = request.camera;
  return (
    isSceneStamp(request.scene) &&
    typeof request.fontSetKey === 'string' &&
    request.fontSetKey.length > 0 &&
    typeof camera === 'object' &&
    camera !== null &&
    [
      camera.x,
      camera.y,
      camera.zoom,
      camera.viewportWidthPx,
      camera.viewportHeightPx,
      camera.dpr,
    ].every(Number.isFinite) &&
    camera.zoom > 0 &&
    camera.dpr > 0 &&
    camera.viewportWidthPx >= 0 &&
    camera.viewportHeightPx >= 0 &&
    typeof request.coverage === 'object' &&
    request.coverage !== null &&
    isProjectionBounds(request.coverage)
  );
}

/**
 * Copies every mutable request component before a delayed host/protocol dispatch.
 *
 * @param request - Valid request.
 * @returns An owned request.
 */
export function copyPreviewRequest(request: PreviewRequest): PreviewRequest {
  return {
    ...request,
    scene: { ...request.scene },
    camera: { ...request.camera },
    coverage: { ...request.coverage },
  };
}

/**
 * The longest font-set key a preview certificate may carry (the page's `contentIdentity`: one
 * entry, about 95 characters, per installed face). The page reads keys this long back
 * (`restoreCachedFontSet`, packages/app); the 4,096 the certificate used to allow fell below the
 * bundled faces' key once added nine (4,207 characters), so every preview was refused.
 */
const MAX_FONT_SET_KEY_LENGTH = 1024 * 1024;

/**
 * Validates the complete plain reply before a worker host accepts it.
 *
 * @param value - Untrusted protocol certificate.
 * @returns Whether all bounded fields required by preview persistence are present.
 */
export function isPreviewCertificate(value: unknown): value is PreviewCertificate {
  if (!isPreviewRequest(value)) return false;
  const certificate = value as Partial<PreviewCertificate>;
  const boundedString = (item: unknown): item is string =>
    typeof item === 'string' && item.length > 0 && item.length <= 4096;
  const safeIndex = (item: unknown): boolean =>
    typeof item === 'number' && Number.isSafeInteger(item) && item >= 0;
  const candidates = certificate.candidates;
  const assets = certificate.assets;
  return (
    certificate.fontSetKey !== undefined &&
    certificate.fontSetKey.length <= MAX_FONT_SET_KEY_LENGTH &&
    safeIndex(certificate.frameIndex) &&
    safeIndex(certificate.resourceGeneration) &&
    typeof certificate.lodPlanKey === 'string' &&
    certificate.lodPlanKey.length >= 2 &&
    certificate.lodPlanKey.length <= 4 * 1024 * 1024 &&
    typeof certificate.imagePlanKey === 'string' &&
    certificate.imagePlanKey.length >= 2 &&
    certificate.imagePlanKey.length <= 4 * 1024 * 1024 &&
    Array.isArray(candidates) &&
    candidates.length <= 100_000 &&
    candidates.every(boundedString) &&
    new Set(candidates).size === candidates.length &&
    Array.isArray(assets) &&
    assets.length <= 100_000 &&
    assets.every((asset: unknown) => {
      if (typeof asset !== 'object' || asset === null) return false;
      const item = asset as Partial<PreviewAssetVersion>;
      return boundedString(item.assetId) && boundedString(item.contentVersion);
    }) &&
    new Set(assets.map((asset: PreviewAssetVersion) => asset.assetId)).size === assets.length
  );
}
