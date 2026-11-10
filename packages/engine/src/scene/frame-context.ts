import type { Camera, WorldBounds } from '../camera/camera.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuColor } from '../gpu/gpu-render-pass.js';

import type { CameraUniform } from './camera-uniform.js';
import type { ClipTableTexture } from './clip-table-texture.js';
import type { DrawListEntry } from './draw-list.js';
import type { InstanceBuffer } from './instance-buffer.js';
import type { LayerDraw } from './layers/layer-draw.js';
import type { SceneChangeQueue } from './scene-change-queue.js';
import type { ScenePassResources } from './scene-pass-resources.js';
import type { Scene } from './scene.js';

/**
 * Called around every stage of a frame, so per-stage CPU time can be measured (each stage has
 * a budget and reports its time). The scene never reads a clock (Global Constraint 3); the stage
 * timers implement this hook with one.
 */
export interface FrameTimerHook {
  /**
   * A stage is about to run.
   *
   * @param stageName - The stage's name.
   */
  stageStarted(stageName: string): void;
  /**
   * A stage has finished, normally or by throwing.
   *
   * @param stageName - The stage's name.
   */
  stageEnded(stageName: string): void;
}

/** The timer hook that measures nothing. */
export const NO_FRAME_TIMERS: FrameTimerHook = {
  stageStarted: () => undefined,
  stageEnded: () => undefined,
};

/** What one frame did, counted by the built-in stages; a stage may add to it. */
export interface FrameStats {
  /** Objects the scene rewrote or removed, descendants included. */
  changedObjects: number;
  /** `writeBuffer` calls: dirty ranges plus the camera uniform. */
  bufferWrites: number;
  /** Bytes those calls wrote. */
  uploadedBytes: number;
  /** `draw` calls. */
  drawCalls: number;
  /**
   * Visible image objects whose asset was ready (its smallest level decoded) drawn without a
   * texture: the "never blank" rule says 0. Counted by the image pass.
   */
  blankImages: number;
  /**
   * Visible image objects drawn from their placeholder because nothing of their asset ever
   * loaded (not described yet, failed, or no level decoded yet): not a broken rule like
   * `blankImages`, but what the memory benchmark's floor bounds. Counted by the image pass.
   */
  placeholderImages: number;
  /** Visible image objects, whatever they drew. Counted by the image pass. */
  visibleImages: number;
  /** Z-order segments the frame's draw list forms (`ZOrderSegments`); 0 without them. */
  segments: number;
  /**
   * Visible-set entries and exits the culler's per-frame budget carried to later frames
   * (`SceneCuller.carriedAdmissions`): 0 once every object the view meets has arrived.
   */
  carriedAdmissions: number;
  /**
   * Objects whose level-of-detail form changed this frame (`LevelOfDetail`).
   */
  lodTransitions: number;
  /**
   * Of those, objects that have now changed form across a threshold more often than their size
   * on screen traversed its whole 20% band, plus one (`LodBand`): thrash, which the hysteresis
   * bands keep at 0.
   */
  lodThrashes: number;
  /**
   * Glyphs the glyph atlas generated again this frame although it evicted them within the last
   * sweep (`REGENERATION_WINDOW_MS`): the no-thrash rule of keeps it at 0.
   */
  atlasRegenerations: number;
  /** Glyph lookups the text passes made this frame (`FrameCounters.atlasLookups`). */
  atlasLookups: number;
  /** Of those, lookups that missed the tier wanted (`FrameCounters.atlasMisses`). */
  atlasMisses: number;
  /** Path meshes built again this frame although the mesh cache evicted them within the window. */
  meshRegenerations: number;
  /**
   * Text runs drawn from their glyphs' outlines this frame (shown above 512 device px
   * per em), each a stencil and a cover draw; 0 while all text draws from the glyph atlas.
   */
  vectorTextRuns: number;
  /** Layers composited through offscreen targets this frame (at most 16). */
  layersDrawn: number;
  /** Layers drawn in the multiply form because they are under 64 device pixels (with a band). */
  layersFallbackSmall: number;
  /** Layers drawn in the multiply form because 16 others composited first. */
  layersFallbackLimit: number;
  /** Layers drawn in the multiply form because their targets would pass the layers budget. */
  layersFallbackBudget: number;
  /**
   * Bytes the layers hold after the frame: resolved targets, composite uniforms and the shared
   * scratch, as charged under the `layers` memory category.
   */
  layerBytes: number;
  /** Render passes the backend began this frame (`GpuBackend.drawStateCounts`). */
  renderPasses: number;
  /** Pipelines it bound this frame, redundant binds skipped where the backend skips them. */
  pipelineSwitches: number;
  /** Bind groups it bound this frame, likewise. */
  bindGroupChanges: number;
}

/**
 * The statistics of a frame that has done nothing yet: every count 0.
 *
 * @returns New, zeroed statistics.
 */
export function emptyFrameStats(): FrameStats {
  return {
    changedObjects: 0,
    bufferWrites: 0,
    uploadedBytes: 0,
    drawCalls: 0,
    blankImages: 0,
    placeholderImages: 0,
    visibleImages: 0,
    segments: 0,
    carriedAdmissions: 0,
    lodTransitions: 0,
    lodThrashes: 0,
    atlasRegenerations: 0,
    atlasLookups: 0,
    atlasMisses: 0,
    meshRegenerations: 0,
    vectorTextRuns: 0,
    layersDrawn: 0,
    layersFallbackSmall: 0,
    layersFallbackLimit: 0,
    layersFallbackBudget: 0,
    layerBytes: 0,
    renderPasses: 0,
    pipelineSwitches: 0,
    bindGroupChanges: 0,
  };
}

/**
 * Everything a {@link FrameStage} may read or write during one frame. Built by
 * `SceneRenderer.renderFrame`; lives for that frame only. Stages communicate through it: `cull`
 * fills `drawList`, stages after it may reorder or split it, and `draw` walks it in order.
 */
export interface FrameContext {
  /** The frame's timestamp in ms, from the caller (for example the rAF time). Never a clock read. */
  readonly timeMs: number;
  /** The frame's sequence number, from 0. */
  readonly frameIndex: number;
  /** This frame's camera. */
  readonly camera: Camera;
  /** The world rectangle the camera shows. */
  readonly viewport: WorldBounds;
  /** The backend to upload and draw through. */
  readonly backend: GpuBackend;
  /** The per-stage timer hook; the frame calls it around every stage. */
  readonly timers: FrameTimerHook;
  /** Document change sets waiting to be applied. */
  readonly changes: SceneChangeQueue;
  /** The scene graph. */
  readonly scene: Scene;
  /** Every pass's CPU instance buffer by pass name (the scene's). */
  readonly instanceBuffers: ReadonlyMap<string, InstanceBuffer>;
  /** The passes with their GPU resources, in draw order. */
  readonly passes: readonly ScenePassResources[];
  /** The camera uniform every pass binds. */
  readonly cameraUniform: CameraUniform;
  /**
   * The clip table's GPU copy every pass binds, for memory reports; absent in frames
   * built without a `SceneRenderer`.
   */
  readonly clipTable?: Pick<ClipTableTexture, 'byteLength'>;
  /**
   * The frame's draw order: filled by `cull` (one entry per pass with visible records, in pass
   * order), rewritten in place by any stage between `cull` and `draw` (z-order segments),
   * and drawn entry by entry by `draw`.
   */
  readonly drawList: DrawListEntry[];
  /**
   * The layers the frame draws offscreen, innermost first: filled by the z-order
   * segments with the draw list, read by the `layers` stage and the layer composite pass.
   */
  readonly layers: LayerDraw[];
  /** The colour the frame clears to, premultiplied. */
  readonly clearColor: GpuColor;
  /** Counters for this frame. */
  readonly stats: FrameStats;
}

/**
 * One step of the frame loop (gather input, apply document updates, update dirty scene nodes, cull,
 * encode, submit). A stage runs synchronously on the thread that owns the backend.
 */
export interface FrameStage {
  /** A unique name within the frame; the anchor for `Frame.insertStage`. */
  readonly name: string;
  /**
   * Does the stage's work for one frame.
   *
   * @param context - The frame's context.
   */
  run(context: FrameContext): void;
}
