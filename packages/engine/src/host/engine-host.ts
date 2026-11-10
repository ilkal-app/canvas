import type { InkTheme } from '@canvas/schema';

import type { Camera, WorldBounds } from '../camera/camera.js';
import type { BenchmarkSample } from '../diagnostics/stats-export.js';
import type { UndrawableObject } from '../drawable/drawable-extent.js';
import type { GpuBackendName, GpuCapabilities, GpuSampleCount } from '../gpu/gpu-capabilities.js';
import type { GpuColor } from '../gpu/gpu-render-pass.js';
import type { ColorTokenValues, InkColors } from '../paint/color-palette.js';
import type { ColorModeFallbackName } from '../scene/color-mode-fallback.js';
import type { FrameStats } from '../scene/frame-context.js';
import type { ChurnBudget } from '../scene/scene-renderer-options.js';
import type { StickyAuthors } from '../text/scene/sticky-author-box.js';
import type { FontFaceSource } from '../text/scene/text-pass-resources.js';

import type { EnginePixels, PixelRect, PixelSize } from './engine-pixels.js';
import type { EngineInputsCompletedListener, InputMark } from './input-marks.js';
import type { PointerInput } from './pointer-input.js';
import type { SceneStamp, PreviewRequest, PreviewCertificate } from './scene-certificate.js';
import type { SceneProjection } from './scene-projection.js';
import type { SerializableChangeSet } from './serializable-change-set.js';

/**
 * Where the engine runs: in a dedicated worker drawing into an `OffscreenCanvas` transferred
 * from the page, or on the main thread drawing into the page canvas.
 */
export type EngineHostKind = 'worker' | 'main';

/** How the engine renders; plain data, so it crosses to the worker. */
export interface EngineHostOptions {
  /** The GPU backend to try first; the other is the fallback. Default `webgpu`. */
  readonly backend?: GpuBackendName;
  /** Samples per pixel. Default 4. */
  readonly sampleCount?: GpuSampleCount;
  /** The premultiplied colour every frame clears to. Default the scene renderer's. */
  readonly clearColor?: GpuColor;
  /**
   * The churn one frame takes on (`SceneRendererOptions.churnBudget`): visible-set
   * entries nearest the viewport centre first, the rest in later frames. Default off.
   */
  readonly churnBudget?: ChurnBudget | false;
  /**
   * The font files text draws with, default face first: handed to the host's
   * `createTextResources`, which loads them where the engine renders. Default none.
   */
  readonly fontFaces?: readonly FontFaceSource[];
  /**
   * Whether text shown above 512 device px per em draws from its glyphs' outlines, sharp at any
   * zoom (`TextPassResources.hasVectorGlyphs`), rather than magnified from the glyph
   * atlas. Default true.
   */
  readonly hasVectorGlyphs?: boolean;
  /**
   * The device the GPU memory budget is set for (`budgetForDevice`): `navigator.deviceMemory` where
   * the browser reports it, and whether it is a phone or tablet. Default: a desktop of unknown
   * memory (512 MiB).
   */
  readonly device?: EngineDeviceOptions;
  /**
   * The viewer's theme at first, which resolves the `'ink'` colour token:
   * `inkColors[theme]`. Change it with `EngineHost.setTheme`. Default `light`.
   */
  readonly theme?: InkTheme;
  /**
   * What ink draws as in each theme: the host's theme tokens' values. Default the schema's
   * `INK_COLORS`.
   */
  readonly inkColors?: InkColors;
  /**
   * The built-in colour mode fallback, by name, as plain data the engine worker can be sent:
   * `'frame-fill-luminance'` makes `'ink'` and tokens follow the nearest filled frame's
   * luminance where no ancestor sets a `colorMode`. Default none: the viewer's theme.
   */
  readonly colorModeFallback?: ColorModeFallbackName;
}

/** The device facts the GPU memory budget depends on; plain data. */
export interface EngineDeviceOptions {
  /** `navigator.deviceMemory`, GiB; absent where the browser does not say. */
  readonly deviceMemoryGb?: number;
  /** Whether the device is a phone or tablet (the 128 MiB class). Default false. */
  readonly isMobile?: boolean;
}

/** What one frame did, as the engine reports it after drawing (its stats event). */
export interface EngineFrameReport {
  /** The frame's sequence number on this host, from 0. */
  readonly frameIndex: number;
  /** Highest ordered acknowledgement marker present when this successfully drawn frame began. */
  readonly acknowledgementId?: number;
  /**
   * When the frame began: its animation-frame timestamp, ms on the page's clock
   * (`performance.now()` of the main thread), converted from the worker's clock when the engine
   * runs there, so reports and pointer timestamps compare directly.
   */
  readonly frameTimeMs: number;
  /** The camera the frame drew with; `undefined` while no camera has been set (nothing drawn). */
  readonly camera: Camera | undefined;
  /**
   * The canvas's drawing buffer when the frame ran, device px: where the engine runs, so it is
   * right even after the page handed the canvas to a worker (whose element keeps its hand-over
   * size).
   */
  readonly drawingBuffer: PixelSize;
  /** What the frame uploaded and drew; all zero when nothing was drawn. */
  readonly stats: FrameStats;
  /** The pointer inputs the frame gathered, coalesced (`coalescePointerInputs`), oldest first. */
  readonly pointerInputs: readonly PointerInput[];
  /**
   * Whether the frame left work a later frame will show (path meshes being built in the job
   * pool): a frame with `false` shows everything sent so far.
   */
  readonly hasPendingWork: boolean;
  /**
   * Whether no image level is being fetched, decoded or waiting to upload (the texture manager is
   * idle): with `hasPendingWork` false and no placeholder or blank image in `stats`, the
   * frame shows every image at the level it wants. Absent where the engine draws no images.
   */
  readonly isImageIdle?: boolean;
  /**
   * Whether the engine's job pool has live job workers (else its jobs, path meshes among them,
   * run on the engine's own thread after each frame): false without job workers, or once every
   * one has failed, a script that did not load included.
   */
  readonly isUsingJobWorkers: boolean;
  /**
   * The objects this frame's document changes left undrawable (a number that is not
   * finite, a negative size, a place past `DRAWABLE_EXTENT`, an undrawable frame or group around
   * them), each once per change that touched it; absent when there were none. The engine draws,
   * indexes and hits them as if absent, and never repairs or removes them: they stay in the
   * document, where they can be selected by id and deleted. What a host shows is its own choice.
   * At most `MAX_REPORTED_UNDRAWABLE` (1,000) are listed; `undrawableCount` counts them all.
   */
  readonly undrawable?: readonly UndrawableObject[];
  /** How many objects this frame's changes left undrawable, listed or not; absent when none. */
  readonly undrawableCount?: number;
  /**
   * How long the last batch before this frame took to reach the worker, and this report to reach
   * the page: only from a worker host while frame statistics record, and absent when
   * the clocks disagree (a negative leg).
   */
  readonly transferMs?: EngineTransferTimings;
}

/** The two thread hops of a worker host, ms on the page's clock. */
export interface EngineTransferTimings {
  /** From the page posting a command batch to the worker receiving it. */
  readonly pageToWorker: number;
  /** From the worker posting a frame report to the page receiving it. */
  readonly workerToPage: number;
}

/**
 * Receives each frame's report.
 *
 * @param report - The frame's report.
 */
export type EngineFrameListener = (report: EngineFrameReport) => void;

/**
 * Receives an error the engine could not attribute to one call: a frame that threw, a worker
 * that crashed, a message that could not be delivered.
 *
 * @param error - What went wrong.
 */
export type EngineFaultListener = (error: Error) => void;

/**
 * The engine as the page drives it, wherever it runs (in a worker where it
 * can, so React and the document store on the main thread cannot jank a frame; Safari and
 * other browsers without `OffscreenCanvas` fall back to the main thread behind this same
 * interface). `createEngineHost` picks the implementation. Every call returns at once; the
 * engine draws on its own animation frames, one frame for everything that arrived since the
 * last. Called from the main thread.
 */
export interface EngineHost {
  /** Where this host runs the engine. */
  readonly kind: EngineHostKind;
  /** The GPU backend the engine draws with: `webgl2` after a switch. */
  readonly capabilities: GpuCapabilities;
  /**
   * Applies a document change on the next frame; several changes between frames are applied
   * once.
   *
   * @param changes - The change, from `serializeChangeSet`.
   * @param stamp - Optional mount revision, contiguous from zero; gaps disable certification.
   */
  applyChangeSet(changes: SerializableChangeSet, stamp?: SceneStamp): void;
  /**
   * Shows a model on the host's overlay layer (`EngineOverlay`, for example the selection
   * overlay) from the next frame, in the same frame as the change sets sent with it. Only the
   * last model of a task is sent, so a busy pointer costs one overlay per frame at most. A host
   * without an overlay layer, or a model the layer refuses, reports a fault.
   *
   * @param model - The model, structured-cloneable plain data.
   */
  setOverlay(model: unknown): void;
  /**
   * Shows or hides the dot grid behind the board from the next frame; hidden until asked. A
   * per-user view preference, never part of the document.
   *
   * @param isVisible - Whether the grid shows.
   */
  setGridVisible(isVisible: boolean): void;
  /**
   * Switches the viewer's theme from the next frame: strokes and text in
   * `'ink'` draw `inkColors[theme]`, and only their instance records are rewritten (no text
   * layout, path mesh or document change). A per-viewer preference, never part of the document;
   * asks for a frame.
   *
   * @param theme - The viewer's theme.
   * @param inkColors - What ink draws as per theme, when it changed; default the current ones.
   */
  setTheme(theme: InkTheme, inkColors?: InkColors): void;
  /**
   * Replaces the board's colour token values from the next frame:
   * records naming a token whose light or dark value changed are rewritten, and only those (no
   * text layout, path mesh or document change). Send the board's table on load and after every
   * change set that names `tokens`; asks for a frame.
   *
   * @param tokens - Each custom token and edited built-in by id, with its light and dark values.
   */
  setColorTokens(tokens: ColorTokenValues): void;
  /**
   * Replaces who wrote each sticky, as the board shows it: from the next frame each
   * sticky shows its author's name bottom-left, or none while authors are hidden. Only the labels
   * that change are laid out again; the notes' own text never is. Asks for a frame.
   *
   * @param authors - Whether authors show, each principal's name and the fallback name.
   */
  setStickyAuthors(authors: StickyAuthors): void;
  /**
   * Draws with this camera from the next frame, stopping any camera animation.
   *
   * @param camera - The camera; its viewport × dpr should match the canvas size.
   */
  setCamera(camera: Camera): void;
  /**
   * Moves the camera to `camera` over `durationMs` on the engine's own frames (zoom
   * geometric, centre linear), so it keeps moving while the main thread is busy. Starts from
   * the camera last drawn; without one it jumps.
   *
   * @param camera - Where the camera ends.
   * @param durationMs - How long the move takes, ms.
   */
  animateCamera(camera: Camera, durationMs: number): void;
  /**
   * Hands the engine one pointer event; the events of a frame are coalesced and reported with
   * it.
   *
   * @param input - The event, with its original timestamp.
   */
  pointer(input: PointerInput): void;
  /**
   * Sizes the canvas's drawing buffer and the camera's viewport to match the canvas on screen.
   *
   * @param widthPx - Drawing buffer width, device px.
   * @param heightPx - Drawing buffer height, device px.
   * @param dpr - Device pixels per CSS pixel.
   */
  resize(widthPx: number, heightPx: number, dpr: number): void;
  /** Asks for a frame even though nothing changed. */
  requestFrame(): void;
  /**
   * Marks previously queued work and requests a frame. Resource loading need not be complete.
   *
   * @returns The actual drawn frame index; rejects on a host fault or destruction.
   */
  requestFrameAcknowledgement?(): Promise<number>;
  /**
   * Names an input for the benchmark: the mark travels after the calls made before
   * it, and `onInputsCompleted` reports it once the GPU finished the frame that took it. Asks
   * for a frame. Optional for custom hosts.
   *
   * @param mark - The input, its times on the page's clock.
   */
  markInput?(mark: InputMark): void;
  /**
   * Subscribes to completed input marks. A mark whose GPU completion fails (a lost device) is
   * dropped, never reported late. Optional for custom hosts.
   *
   * @param listener - Called once per frame that carried marks, times on the page's clock.
   * @returns Unsubscribes.
   */
  onInputsCompleted?(listener: EngineInputsCompletedListener): () => void;
  /**
   * Reads what the next frame draws, inside that frame (a GPU canvas can be read only in the
   * task that drew it), and returns a copy of the rectangle.
   *
   * @param rect - The rectangle, device px of the drawing buffer.
   * @returns The pixels, RGBA8 premultiplied; rejects when the rectangle is outside the canvas,
   *   no camera is set, the read fails or the host is destroyed first.
   */
  readPixels(rect: PixelRect): Promise<EnginePixels>;
  /**
   * Reads indexed candidates after the next frame; optional for custom hosts.
   *
   * @param bounds - Coverage in world units.
   * @returns Candidates, not document identity or resource-readiness evidence.
   */
  readProjection?(bounds: WorldBounds): Promise<SceneProjection | undefined>;
  /**
   * Requests a complete preview certificate. Optional for custom hosts; currently undefined.
   *
   * @param request - Exact scene, camera and resource identities to certify.
   * @returns Evidence only when all contributors are proven, otherwise undefined.
   */
  readPreviewCertificate?(request: PreviewRequest): Promise<PreviewCertificate | undefined>;
  /**
   * Starts recording frame statistics where the engine runs: stage timers on the engine's frame,
   * installed the first time, and a new run (an empty history) every time, as before a benchmark
   * scenario.
   *
   * @param capacity - Frames the history keeps (default 240); size it to the scenario so its
   *   percentiles cover all of it. Not a positive integer: a `RangeError`, thrown on the main
   *   thread and reported as a fault from a worker.
   */
  startFrameStats(capacity?: number): void;
  /**
   * Reads the statistics of the frames drawn since they last started: CPU time per stage, GPU
   * time per timed pass, the per-frame counters and GPU memory by category.
   *
   * @returns The summary, plain data; rejects when statistics were never started or the host is
   *   destroyed first.
   */
  readFrameStats(): Promise<BenchmarkSample>;
  /**
   * Stops recording frame statistics and removes the stage timers, so frames pay nothing for
   * them; a later read rejects until they start again. Does nothing when they are not running.
   */
  stopFrameStats(): void;
  /**
   * Subscribes to every frame's report.
   *
   * @param listener - Called after each frame, on the main thread.
   * @returns Unsubscribes.
   */
  onFrame(listener: EngineFrameListener): () => void;
  /**
   * Subscribes to faults. While nobody is subscribed a fault is thrown instead, as an uncaught
   * error, so it is never silent.
   *
   * @param listener - Called with each fault, on the main thread.
   * @returns Unsubscribes.
   */
  onFault(listener: EngineFaultListener): () => void;
  /**
   * Loses the GPU device as a driver reset would, for browser tests of recovery: a WebGL2
   * context is restored on its canvas; after a WebGPU loss the engine goes on with WebGL2 on a
   * fresh canvas laid over the page canvas.
   */
  loseDeviceForTesting(): void;
  /** Stops drawing and frees the GPU resources (and the worker); later calls do nothing. */
  destroy(): void;
}
