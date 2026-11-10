import { newDrawStateCounts, type GpuDrawStateCounts } from '../gpu/gpu-draw-state-counts.js';

import type { DrawStageBackground } from './draw-stage-background.js';
import type { FrameContext, FrameStage } from './frame-context.js';
import { PageRangeCache } from './page-range-cache.js';
import type { SceneCuller } from './scene-culler.js';

/**
 * The built-in stages' names, in run order: the anchors other work inserts stages around.
 * `levelOfDetail` is the level-of-detail stage (`lod/`), which `SceneRenderer` installs
 * right after `collectChanges`; `zOrderSegments` is `ZOrderSegments` (`segments/`), which it
 * installs after `cull` unless `isZOrdered` is false; `layers` renders the frame's offscreen
 * layers, last before `draw`.
 */
export const BUILT_IN_STAGE_NAMES = [
  'collectChanges',
  'levelOfDetail',
  'uploadDirtyRanges',
  'cull',
  'zOrderSegments',
  'layers',
  'draw',
  'submit',
] as const;

/**
 * Applies the document change sets queued since the last frame to the scene, coalesced into
 * one.
 */
export const COLLECT_CHANGES_STAGE: FrameStage = {
  name: 'collectChanges',
  run(context) {
    const changes = context.changes.drain();
    if (changes) context.stats.changedObjects += context.scene.apply(changes);
  },
};

/**
 * Writes the camera uniform if the camera changed, then each pass's dirty instance ranges. A
 * frame with no document change and the same camera writes nothing.
 */
export const UPLOAD_DIRTY_RANGES_STAGE: FrameStage = {
  name: 'uploadDirtyRanges',
  run(context) {
    if (context.cameraUniform.update(context.camera)) {
      context.stats.bufferWrites += 1;
      context.stats.uploadedBytes += context.cameraUniform.buffer.byteLength;
    }
    for (const pass of context.passes) pass.upload(context.stats);
  },
};

/**
 * Creates the stage that decides what each pass draws: it replaces `context.drawList` with one
 * entry per pass that has visible records, in pass order, and for a paged pass one entry per
 * page it draws (`splitRangesByPage`), pages ascending.
 *
 * @param culler - The strategy: `SpatialCuller` by default, `AllVisibleCuller` to cull nothing.
 * @returns The `cull` stage.
 */
export function createCullStage(culler: SceneCuller): FrameStage {
  const pageRangeCache = new PageRangeCache();
  return {
    name: 'cull',
    run(context) {
      const visible = culler.cull(context.scene, context.viewport);
      context.stats.carriedAdmissions = culler.carriedAdmissions?.() ?? 0;
      context.drawList.length = 0;
      for (const { pass } of context.passes) {
        const ranges = visible.get(pass.name);
        if (!ranges || ranges.length === 0) continue;
        const pages = context.scene.pagesOf(pass.name);
        if (pages === undefined) {
          context.drawList.push({ passName: pass.name, ranges });
          continue;
        }
        for (const { page, ranges: pageRanges } of pageRangeCache.split(
          context.scene,
          pass.name,
          ranges,
          pages,
          culler.rangeChangeOf?.(pass.name),
        )) {
          context.drawList.push({ passName: pass.name, page, ranges: pageRanges });
        }
      }
    },
  };
}

/**
 * Creates the stage that encodes the frame: one render pass that clears the canvas, draws the
 * background (the dot grid) if there is one, then every entry of `context.drawList` in
 * list order, one instanced draw per range (a paged pass's entry with its page's bind group; the
 * pass drawer's draws, for a custom-draw pass), so a stage that reorders the list (z-order
 * segments) reorders the draws, and the background is under every object, paths included.
 *
 * @param timingLabel - Label the render pass for GPU timing (`collectPassTimings`); omit for
 *   none.
 * @param background - What to paint under every object; its `prepare` runs before the pass
 *   opens. Omit for none.
 * @returns The `draw` stage; it throws a `RangeError` when a draw list entry names no pass.
 */
export function createDrawStage(
  timingLabel?: string,
  background?: DrawStageBackground,
): FrameStage {
  return {
    name: 'draw',
    run(context) {
      background?.prepare(context);
      const renderPass = context.backend.beginRenderPass(
        timingLabel === undefined
          ? { clearColor: context.clearColor }
          : { clearColor: context.clearColor, timingLabel },
      );
      const passesByName = new Map(context.passes.map((pass) => [pass.pass.name, pass]));
      try {
        background?.draw(renderPass, context);
        for (const entry of context.drawList) {
          if (entry.layer !== undefined) continue; // Drawn into its layer by the `layers` stage.
          const pass = passesByName.get(entry.passName);
          if (!pass) {
            throw new RangeError(`The draw list names no scene pass "${entry.passName}".`);
          }
          pass.drawEntry(renderPass, entry, context);
        }
      } finally {
        renderPass.end();
      }
    },
  };
}

/** Sends the frame's recorded passes to the GPU. */
export const SUBMIT_STAGE: FrameStage = {
  name: 'submit',
  run(context) {
    context.backend.submit();
    noteDrawState(context);
  },
};

/** Each backend's draw-state counts at its last submit, for the next frame's difference. */
const countsAtSubmit = new WeakMap<object, GpuDrawStateCounts>();

/**
 * Copies the draw state the backend set since its last submit into the frame's statistics:
 * render passes, pipeline switches and bind-group changes; none without counts.
 *
 * @param context - The frame.
 */
function noteDrawState(context: FrameContext): void {
  const { backend, stats } = context;
  const counts = backend.drawStateCounts;
  if (counts === undefined) return;
  const last = countsAtSubmit.get(backend) ?? newDrawStateCounts();
  stats.renderPasses = counts.renderPasses - last.renderPasses;
  stats.pipelineSwitches = counts.pipelineSwitches - last.pipelineSwitches;
  stats.bindGroupChanges = counts.bindGroupChanges - last.bindGroupChanges;
  countsAtSubmit.set(backend, { ...counts });
}
