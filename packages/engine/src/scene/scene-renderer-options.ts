import type { InkTheme } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import type { GpuColor } from '../gpu/gpu-render-pass.js';
import type { LevelOfDetail } from '../lod/level-of-detail.js';
import type { ColorTokenValues, InkColors } from '../paint/color-palette.js';

import type { ColorModeFallbackOption } from './color-mode-fallback.js';
import { colorOptionsOf } from './color-targets.js';
import type { DrawStageBackground } from './draw-stage-background.js';
import type { FrameTimerHook } from './frame-context.js';
import { LAYER_COMPOSITE_PASS_NAME } from './layers/layer-composite-pass-name.js';
import type { SceneCuller } from './scene-culler.js';
import type { ScenePass, ScenePassEntry, ScenePassEnvironment } from './scene-pass.js';
import type { SceneOptions } from './scene.js';

/**
 * How much visible-set and level-of-detail churn one frame takes on: the rest waits
 * for the next frames, which the renderer asks for (`SceneRenderer.hasPendingWork`).
 */
export interface ChurnBudget {
  /**
   * The most visible-set entries and exits per frame (`SpatialCullerOptions.entriesPerFrame`);
   * default {@link DEFAULT_CHURN_BUDGET}'s.
   */
  readonly entriesPerFrame?: number;
  /**
   * The most level-of-detail form changes per frame (`LevelOfDetailOptions.changesPerFrame`);
   * default {@link DEFAULT_CHURN_BUDGET}'s.
   */
  readonly lodChangesPerFrame?: number;
}

/**
 * The churn budget `SceneRendererOptions.churnBudget` fills in, sized on the 50k zoom sweep to split only the
 * spikes: every frame that admits a batch also re-plans its z-order segments, so a small cap
 * turns one spike into many medium frames and raises p95 (2,000 entries: local p95 1.9 → 7.4 ms),
 * while 6,000 keeps p95 near the uncapped run's and cuts the worst frame (45 → 31 ms locally).
 */
export const DEFAULT_CHURN_BUDGET: Required<ChurnBudget> = {
  entriesPerFrame: 6000,
  lodChangesPerFrame: 3000,
};

/** Options for a `SceneRenderer`. */
export interface SceneRendererOptions {
  /**
   * The passes, in draw order: pass values, or factories that build a pass for this renderer
   * (passes with state or GPU resources of their own). Default: the solid-rect pass (frame
   * backgrounds) and the SDF shape pass (shapes and sticky notes), each followed by its
   * gradient variant (`RECT_GRADIENT_PASS`, `SDF_SHAPE_GRADIENT_PASS`) and its image variant
   * (`RECT_IMAGE_PASS`, `SDF_SHAPE_IMAGE_PASS`); hosts render
   * `createStandardScenePasses`.
   */
  readonly passes?: readonly ScenePassEntry[];
  /**
   * What pass factories build with besides the backend: a frame request for work that lands
   * between frames, a clock for work budgets, and resources such as fonts. Default: no frame
   * requests and a clock stuck at 0.
   */
  readonly environment?: Partial<Omit<ScenePassEnvironment, 'backend' | 'levelOfDetail'>>;
  /**
   * What the `cull` stage draws. Default: a new `SpatialCuller` (R-tree culling with a
   * padded viewport). A `SpatialCuller`, given or default, is fed every change set the scene
   * applies; pass your own to share its index with hit testing.
   */
  readonly culler?: SceneCuller;
  /**
   * The churn one frame takes on: visible-set entries and exits, and level-of-detail
   * form changes, with {@link DEFAULT_CHURN_BUDGET} for any field not given (`{}` for all of
   * them), new entries nearest the viewport centre first, so a fast zoom brings objects in over a
   * few frames instead of in one long one. Default `false`, no cap: on the m1's 50k
   * sweep the cap cuts the desktop worst frame by a fifth but raises the mobile p95 by a third, as
   * it spreads the same work over more frames; the owner decides. Only the default culler takes
   * `entriesPerFrame`: one passed in as `culler` keeps its own.
   */
  readonly churnBudget?: ChurnBudget | false;
  /** The premultiplied colour each frame clears to. Default a near-white `[0.98, 0.98, 0.98, 1]`. */
  readonly clearColor?: GpuColor;
  /** Called around every stage. Default: measures nothing. */
  readonly timers?: FrameTimerHook;
  /** Label the frame's render pass for GPU timing; default unlabelled. */
  readonly timingLabel?: string;
  /**
   * What the `draw` stage paints under every object, such as the dot grid (`GridBackground`,
   *); default nothing. The caller owns it and destroys it.
   */
  readonly background?: DrawStageBackground;
  /** Scene options: instance buffer capacity and coalescing. */
  readonly scene?: SceneOptions;
  /**
   * Whether the frame draws in z order: `ZOrderSegments` rewrites the draw list after `cull`
   * into z-order segments. Default true; false draws each pass's visible ranges in slot
   * order, pass after pass.
   */
  readonly isZOrdered?: boolean;
  /**
   * The viewer's theme, which resolves the `'ink'` colour token: strokes
   * and text in ink draw `inkColors[theme]`. Change it with `SceneRenderer.setTheme`. Default
   * `light`.
   */
  readonly theme?: InkTheme;
  /**
   * What ink draws as in each theme: the host's theme tokens' values. Default the schema's
   * `INK_COLORS`.
   */
  readonly inkColors?: InkColors;
  /**
   * The board's colour token values at first: what `{ token }`
   * references and `'ink'` draw as besides the built-in defaults. Change them with
   * `SceneRenderer.setColorTokens`. Default none.
   */
  readonly colorTokens?: ColorTokenValues;
  /**
   * Asked for an object's colour mode when no ancestor-or-self frame, main or instance sets one,
   * before the viewer's theme. A hook, called when the object or an ancestor is applied, its board
   * reading the scene's source; or a built-in by name: `'frame-fill-luminance'`, the
   * nearest filled frame's luminance, which a theme switch or a token edit works out again where a
   * frame's fill is a token. Absent: none.
   */
  readonly colorModeFallback?: ColorModeFallbackOption;
}

export type { InkColors } from '../paint/color-palette.js';

/** What `SceneRenderer.renderFrame` needs from its caller. */
export interface FrameInput {
  /** The frame's timestamp in ms, for example the rAF time; the scene reads no clock. */
  readonly timeMs: number;
  /** This frame's camera; its viewport × dpr should match the canvas size in device pixels. */
  readonly camera: Camera;
}

/**
 * The scene's options from the renderer's: its own, the shared level of detail, the colours, and
 * whether layer form is drawn, which needs both the layer composite pass and the
 * z-order segments that plan layers; without either, every opacity multiplies (C1's form).
 *
 * @param options - The renderer's options.
 * @param passes - The built passes.
 * @param levelOfDetail - The level of detail the renderer shares with its passes.
 * @returns The scene's options.
 */
export function sceneOptionsOf(
  options: SceneRendererOptions,
  passes: readonly ScenePass[],
  levelOfDetail: LevelOfDetail,
): SceneOptions {
  const isLayerFormDrawn =
    (options.isZOrdered ?? true) && passes.some(({ name }) => name === LAYER_COMPOSITE_PASS_NAME);
  return { ...options.scene, levelOfDetail, ...colorOptionsOf(options), isLayerFormDrawn };
}
