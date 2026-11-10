import {
  isPreviewCertificate,
  isSameCamera,
  isVirtualObjectId,
  visibleWorldBounds,
  type PreviewCertificate,
} from '@canvas/engine';

import { candidateOwners } from './instance-projection.js';

/**
 * Compares historical resource evidence with a freshly certified, still-hidden reopened frame.
 *
 * @param previous - Validated cached evidence.
 * @param current - New mounted frame's untrusted optional evidence.
 * @returns Whether the same candidates and content were drawn in the exact cached viewport.
 *   A fresh virtual candidate counts as its owner, the id the cache stores (ruling 9).
 */
export function matchesPreviewResources(previous: PreviewCertificate, current: unknown): boolean {
  if (!isPreviewCertificate(previous) || !isPreviewCertificate(current)) return false;
  const drawn = current.candidates.some(isVirtualObjectId)
    ? candidateOwners(current.candidates)
    : current.candidates;
  if (
    !isSameCamera(previous.camera, current.camera) ||
    previous.fontSetKey !== current.fontSetKey ||
    previous.imagePlanKey !== current.imagePlanKey ||
    previous.lodPlanKey !== current.lodPlanKey ||
    previous.candidates.length !== drawn.length ||
    previous.assets.length !== current.assets.length
  )
    return false;
  const coverage = current.coverage;
  const viewport = visibleWorldBounds(current.camera);
  if (
    coverage.minX > viewport.minX ||
    coverage.minY > viewport.minY ||
    coverage.maxX < viewport.maxX ||
    coverage.maxY < viewport.maxY ||
    coverage.minX !== previous.coverage.minX ||
    coverage.minY !== previous.coverage.minY ||
    coverage.maxX !== previous.coverage.maxX ||
    coverage.maxY !== previous.coverage.maxY
  )
    return false;
  const candidates = new Set(previous.candidates);
  if (drawn.some((id) => !candidates.has(id))) return false;
  const assets = new Map(previous.assets.map((asset) => [asset.assetId, asset.contentVersion]));
  return current.assets.every((asset) => assets.get(asset.assetId) === asset.contentVersion);
}
