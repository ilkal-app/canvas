import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import type { MovePlacementBinding } from '../gpu/move-placement.js';
import type { InstanceBuffer } from '../scene/instance-buffer.js';
import type { BoundsVisibilityWitness } from '../spatial/bounds-visibility-witness.js';
import { intersectsBounds } from '../spatial/bounds.js';

import { placedBounds, type TrackedPath } from './path-registry.js';

/** A preparation's retained candidates: each path's placed bounds, by id. */
export type PathCandidates = Map<
  ObjectId,
  { readonly path: TrackedPath; readonly bounds: WorldBounds }
>;

/**
 * Observes exact ordinary or retained-placement bounds in the camera preparation witness.
 *
 * @param path - The tracked path.
 * @param viewport - Current viewport.
 * @param instances - Ordinary geometry records.
 * @param placement - Optional absolute-placement table.
 * @param candidates - This preparation's retained candidate bounds.
 * @param visibility - The current intersection witness.
 * @returns Whether the path intersects the viewport.
 */
export function observePathCandidate(
  path: TrackedPath,
  viewport: WorldBounds,
  instances: InstanceBuffer,
  placement: MovePlacementBinding | undefined,
  candidates: PathCandidates,
  visibility: BoundsVisibilityWitness,
): boolean {
  const candidate = candidates.get(path.id);
  if (candidate) return intersectsBounds(viewport, candidate.bounds);
  const slot = path.slots[0];
  if (slot === undefined) return false;
  const index = placement?.indexData[slot] ?? 0;
  const at = slot * instances.layout.floatsPerRecord;
  const moved = index !== 0 ? placement?.table.read(index) : undefined;
  const data = instances.data;
  const bounds = placedBounds(
    path.localBounds,
    moved?.cos ?? data[at] ?? 1,
    moved?.sin ?? data[at + 1] ?? 0,
    moved?.x ?? data[at + 2] ?? 0,
    moved?.y ?? data[at + 3] ?? 0,
  );
  candidates.set(path.id, { path, bounds });
  visibility.observe(viewport, bounds);
  return intersectsBounds(viewport, bounds);
}
