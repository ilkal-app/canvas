import type { LevelOfDetail } from '../lod/level-of-detail.js';
import type { FrameContext } from '../scene/frame-context.js';
import type { InstanceRange } from '../scene/scene-culler.js';
import type { BoundsVisibilityWitness } from '../spatial/bounds-visibility-witness.js';

interface PreparedFrame {
  readonly bucket: number;
  readonly lod: LevelOfDetail;
  update: number;
  readonly ranges: readonly InstanceRange[];
  visibility: BoundsVisibilityWitness | undefined;
}

/** Independent snapshots proving a settled path preparation can be reused. */
export class PathPreparationCache {
  private previous: PreparedFrame | undefined;

  /**
   * Creates a cache for one path pass.
   *
   * @param passName - The pass whose ranges and LOD forms matter.
   */
  constructor(private readonly passName: string) {}

  /** Forgets a preparation after document, instance or mesh changes. */
  invalidate(): void {
    this.previous = undefined;
  }

  /**
   * Tests the current frame and advances the LOD cursor only after a match.
   *
   * @param context - The current frame.
   * @param bucket - Its hysteretic device-pixel flatten bucket.
   * @returns Whether all previously prepared candidates still draw the same meshes.
   */
  reuse(context: FrameContext, bucket: number): boolean {
    const previous = this.match(context, bucket);
    if (!previous?.visibility?.accepts(context.viewport)) return false;
    previous.update = context.scene.levelOfDetail.updateRevision;
    return true;
  }

  /**
   * Retains candidate bounds across viewport-only changes; membership must be checked again.
   *
   * @param context - The current frame.
   * @param bucket - Its flatten bucket.
   * @returns Whether candidate identities, geometry, forms and ranges are unchanged.
   */
  reuseCandidates(context: FrameContext, bucket: number): boolean {
    const previous = this.match(context, bucket);
    if (!previous) return false;
    previous.update = context.scene.levelOfDetail.updateRevision;
    // Its old witness describes the old membership and must not prove a later return pan.
    previous.visibility = undefined;
    return true;
  }

  private match(context: FrameContext, bucket: number): PreparedFrame | undefined {
    const previous = this.previous;
    const lod = context.scene.levelOfDetail;
    if (previous?.bucket !== bucket || previous.lod !== lod) return undefined;
    if (lod.updateRevision !== previous.update + 1 || lod.changedIn(this.passName).size > 0) {
      return undefined;
    }
    let index = 0;
    for (const entry of context.drawList) {
      if (entry.passName !== this.passName) continue;
      for (const range of entry.ranges) {
        const old = previous.ranges[index++];
        if (old?.start !== range.start || old.count !== range.count) return undefined;
      }
    }
    if (index !== previous.ranges.length) return undefined;
    return previous;
  }

  /**
   * Remembers a fully prepared frame, copying any caller-owned mutable values.
   *
   * @param context - The prepared frame.
   * @param bucket - Its flatten bucket.
   * @param visibility - The fixed candidates' copied intersection constraints.
   */
  remember(context: FrameContext, bucket: number, visibility: BoundsVisibilityWitness): void {
    this.previous = {
      bucket,
      lod: context.scene.levelOfDetail,
      update: context.scene.levelOfDetail.updateRevision,
      ranges: context.drawList
        .filter((entry) => entry.passName === this.passName)
        .flatMap((entry) => entry.ranges.map((range) => ({ ...range }))),
      visibility: visibility.copy(),
    };
  }
}
