import type { MovePlacementBinding } from '../gpu/move-placement.js';
import type { ScenePassDrawerSetup } from '../scene/scene-pass-drawer.js';
import type { ScenePass } from '../scene/scene-pass.js';

import { createPathPipelines, destroyPathPipelines, type PathPipelines } from './path-pipelines.js';

/** Owns optional move pipelines and the placement revision used by path preparation caches. */
export class PathMoveState {
  /** Current borrowed resources, absent for ordinary drawing. */
  placement: MovePlacementBinding | undefined;
  /** Current move pipelines, owned here. */
  pipelines: PathPipelines | undefined;
  private revision = -1;

  constructor(
    private readonly setup: ScenePassDrawerSetup,
    private readonly pass: ScenePass,
  ) {}

  /**
   * Changes the borrowed resources and rebuilds pipelines only when their texture changes.
   *
   * @param placement - The session's resources, or undefined at its end.
   */
  set(placement: MovePlacementBinding | undefined): void {
    if (placement?.table !== this.placement?.table) {
      this.destroy();
      if (placement)
        this.pipelines = createPathPipelines(
          this.setup.backend,
          this.pass.pipelineSpec,
          this.pass.layout,
          this.setup.cameraUniform.buffer,
          this.setup.clipTable,
          `${this.setup.passName} move`,
          placement,
          this.pass,
        );
    }
    this.placement = placement;
    this.revision = -1;
  }

  /**
   * Invalidates camera-only preparation when placements change without dirty geometry records.
   *
   * @returns Whether a new table revision must be prepared.
   */
  takeChange(): boolean {
    const revision = this.placement?.table.revision ?? -1;
    if (this.revision === revision) return false;
    this.revision = revision;
    return true;
  }

  /** Releases pipelines before the caller releases their borrowed texture and index buffer. */
  destroy(): void {
    if (this.pipelines) destroyPathPipelines(this.pipelines);
    this.pipelines = undefined;
    this.placement = undefined;
    this.revision = -1;
  }
}
