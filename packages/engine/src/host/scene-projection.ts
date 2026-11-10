import type { ObjectId } from '@canvas/schema';

import type { Camera, WorldBounds } from '../camera/camera.js';
import type { SceneRenderer } from '../scene/scene-renderer.js';

import { toError } from './frame-reads.js';

/** Indexed candidates read after a frame; callers still establish resource and document fidelity. */
export interface SceneProjection {
  /** Objects whose current indexed drawing bounds intersect the requested coverage. */
  readonly candidates: readonly ObjectId[];
  /** The camera at the frame barrier. */
  readonly camera: Camera;
  /** The renderer's pending-job signal; not proof that all fonts and images are ready. */
  readonly hasPendingWork: boolean;
}

interface PendingProjection {
  readonly bounds: WorldBounds;
  readonly resolve: (projection: SceneProjection | undefined) => void;
  readonly reject: (error: Error) => void;
}

/** Frame-barrier candidate reads owned by one runtime, including teardown and failure handling. */
export class ProjectionReads {
  private readonly pending: PendingProjection[] = [];

  /**
   * Queues a candidate query for the next successful frame.
   *
   * @param bounds - Finite, ordered world bounds; copied before returning.
   * @returns The eventual frame's candidates, or undefined without a camera/spatial index.
   */
  read(bounds: WorldBounds): Promise<SceneProjection | undefined> {
    if (!isProjectionBounds(bounds))
      return Promise.reject(new RangeError('Projection bounds must be finite and ordered.'));
    return new Promise((resolve, reject) => {
      this.pending.push({ bounds: { ...bounds }, resolve, reject });
    });
  }

  /**
   * Answers queued reads only after the runtime has applied changes and drawn its frame.
   *
   * @param renderer - The renderer after its frame.
   * @param camera - The camera drawn, absent before the first camera arrives.
   * @param hasPendingChanges - Runtime arrivals queued after the frame consumed its changes.
   */
  answer(renderer: SceneRenderer, camera: Camera | undefined, hasPendingChanges = false): void {
    for (const read of this.pending.splice(0)) {
      try {
        const candidates =
          camera === undefined || hasPendingChanges
            ? undefined
            : renderer.projectionCandidates(read.bounds);
        read.resolve(
          candidates === undefined || camera === undefined
            ? undefined
            : {
                candidates,
                camera: { ...camera },
                hasPendingWork: renderer.hasPendingWork(),
              },
        );
      } catch (error) {
        read.reject(toError(error));
      }
    }
  }

  /**
   * Rejects outstanding queries when a frame fails or the runtime is destroyed.
   *
   * @param error - The frame or lifecycle failure.
   */
  reject(error: Error): void {
    for (const read of this.pending.splice(0)) read.reject(error);
  }
}

/**
 * Checks coverage before sending a query across the host protocol.
 *
 * @param bounds - World-space coverage.
 * @returns Whether every coordinate is finite and the rectangle is ordered.
 */
export function isProjectionBounds(bounds: WorldBounds): boolean {
  return (
    [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite) &&
    bounds.minX <= bounds.maxX &&
    bounds.minY <= bounds.maxY
  );
}
