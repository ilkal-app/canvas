import type { WorldBounds } from '../camera/camera.js';

import type { Scene } from './scene.js';

/** A run of instance records to draw: `count` records from record `start`. */
export interface InstanceRange {
  /** The first record, an index into the pass's instance buffer. */
  readonly start: number;
  /** How many records. */
  readonly count: number;
}

/** A bounded delta of actual drawn slots, including offscreen gap bridges. */
export interface CullRangeChange {
  /** Identity of the provider whose revisions are comparable. */
  readonly source: object;
  /** The current drawn-slot revision. */
  readonly revision: number;
  /** The revision from which this delta was computed. */
  readonly previousRevision: number;
  /** Drawn slots added since the previous revision, including bridge slots. */
  readonly added: readonly InstanceRange[];
  /** Drawn slots removed since the previous revision, including bridge slots. */
  readonly removed: readonly InstanceRange[];
}

/**
 * Decides which instance records a frame draws, so only visible objects cost anything: the
 * `cull` stage's strategy. `SpatialCuller` (`src/spatial/`), the `SceneRenderer` default,
 * implements it with an R-tree query of the viewport padded by a margin.
 */
export interface SceneCuller {
  /**
   * Finds the records to draw this frame.
   *
   * @param scene - The scene, with its instance buffers.
   * @param viewport - The world rectangle the camera shows.
   * @returns The ranges to draw per pass name; a pass with no entry draws nothing.
   */
  cull(scene: Scene, viewport: WorldBounds): ReadonlyMap<string, readonly InstanceRange[]>;
  /**
   * Optional precise range changes; consumers missing a revision must rebuild from cull output.
   *
   * @param passName - The pass.
   * @returns Its last bounded change, or undefined when only full ranges are available.
   */
  rangeChangeOf?(passName: string): CullRangeChange | undefined;
  /**
   * Optional: how many visible-set changes a per-frame budget carried to later frames
   * (`FrameStats.carriedAdmissions`); absent counts as 0.
   *
   * @returns The count after the last `cull`.
   */
  carriedAdmissions?(): number;
}

/**
 * The culler that culls nothing: every pass draws its whole buffer, `[0, recordCount)`, whatever
 * the viewport. Released slots in that range are zeroed and draw nothing. For tests and tiny
 * scenes; `SceneRenderer` culls with `SpatialCuller` unless given this.
 */
export class AllVisibleCuller implements SceneCuller {
  /**
   * Reports every record of every non-empty pass as visible, whatever the viewport.
   *
   * @param scene - The scene.
   * @returns One range per pass that has records.
   */
  cull(scene: Scene): ReadonlyMap<string, readonly InstanceRange[]> {
    const ranges = new Map<string, readonly InstanceRange[]>();
    for (const [name, buffer] of scene.instanceBuffers) {
      if (buffer.recordCount > 0) ranges.set(name, [{ start: 0, count: buffer.recordCount }]);
    }
    return ranges;
  }
}
