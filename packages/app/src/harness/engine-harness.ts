import type {
  BenchmarkSample,
  Camera,
  EngineFrameReport,
  EngineHostKind,
  GpuBackendName,
  InputMarkKind,
  SerializableChangeSet,
  SceneProjection,
  TraceTintModel,
  WorldBounds,
} from '@canvas/engine';
import type { BoardObject, ReactionEvent } from '@canvas/schema';

import type { InputCompletion, PageLongTask, TransferTiming } from './page-latency.js';

/** The property of the engine's canvas that holds its {@link EngineHarness}. */
export type EngineHarnessProperty = 'engineHarness';

/**
 * The canvas as the engine harness leaves it: it holds its {@link EngineHarness} in the
 * {@link EngineHarnessProperty} property once the engine runs.
 */
export type EngineHarnessCanvas = HTMLCanvasElement &
  Partial<Record<EngineHarnessProperty, EngineHarness>>;

/**
 * The engine's side of the scenario-test harness, on the canvas the engine draws into,
 * in `VITE_CANVAS_HARNESS=1` builds of the standalone page whenever the engine runs behind an
 * engine host: the default shell and `?engine=worker` or `?engine=main`. It records
 * every frame's report, so a test can check that frames kept coming while the main thread was
 * busy, drives the engine directly (change sets and cameras the page's document and camera
 * never see) or through the page's document, and reads the engine's frame statistics for the
 * benchmark harness. Main thread.
 */
export interface EngineHarness {
  /** Where the engine runs: `worker` unless it fell back to the main thread. */
  readonly hostKind: EngineHostKind;
  /** The GPU backend it draws with now: `webgl2` after a WebGPU loss. */
  readonly backendName: GpuBackendName;
  /** The adapter or renderer the backend reports, for example `ANGLE (Apple, … Apple M1 Max …)`. */
  readonly adapterName: string;
  /** Whether that adapter is a software rasterizer, on which no timing or pixel is judged. */
  readonly isSoftwareAdapter: boolean;
  /** Whether the backend reports GPU time per pass (timestamp queries). */
  readonly hasTimestampQuery: boolean;
  /**
   * The frames drawn so far, oldest first; the last thousand are kept.
   *
   * @returns Their reports, times on the page's clock.
   */
  frames(): readonly EngineFrameReport[];
  /**
   * The page's long tasks (50 ms or more on its main thread) that began at or after a time: what
   * the page's own work (the select tool, serialising change sets) costs while the engine draws.
   *
   * @param sinceMs - The time, ms on the page's clock.
   * @returns The tasks, oldest first; none where the browser has no `longtask` entries.
   */
  pageLongTasks(sinceMs: number): readonly PageLongTask[];
  /** Whether the browser reports long tasks, so `pageLongTasks` can find any. */
  readonly canObserveLongTasks: boolean;
  /**
   * Whether the browser reports long animation frames, so `pageLongAnimationFrames` can find any:
   * a benchmark checks it before trusting zero freezes.
   */
  readonly canObserveLongAnimationFrames: boolean;
  /**
   * Long animation frames, including frames delayed by a series of shorter tasks.
   *
   * @param sinceMs - Start time on the page clock, ms.
   * @returns Frames, oldest first; empty where the browser does not support them.
   */
  pageLongAnimationFrames(sinceMs: number): readonly PageLongTask[];
  /**
   * For each pointer input of the frames the page received at or after a time: the time from the
   * input event to the page hearing that the frame which took it was drawn, ms.
   *
   * @param sinceMs - The time, ms on the page's clock.
   * @returns The latencies, in the order the frames arrived.
   */
  inputLatenciesMs(sinceMs: number): readonly number[];
  /**
   * Marks every later DOM event of a type as a benchmark input, after the app's own
   * window listeners ran, or stops marking it; nothing is marked until a type is armed.
   *
   * @param eventType - The DOM event type, for example `keydown` or `pointerup`.
   * @param kind - The input kind; `undefined` disarms the type.
   */
  armInputMarks(eventType: string, kind: InputMarkKind | undefined): void;
  /**
   * For each marked input the page heard complete at or after a time: the time from the event
   * to the GPU finishing the frame that took it (not to presentation).
   *
   * @param sinceMs - The time, ms on the page's clock.
   * @returns One entry per mark, oldest first; the last thousand are kept.
   */
  inputCompletions(sinceMs: number): readonly InputCompletion[];
  /**
   * The page-to-worker and worker-to-page hops of the frames that began at or after a time;
   * only a worker host reports them, and only while frame statistics record.
   *
   * @param sinceMs - The time, ms on the page's clock.
   * @returns One entry per frame that carried them, oldest first.
   */
  transferTimings(sinceMs: number): readonly TransferTiming[];
  /**
   * For each keyboard input (the page's `beforeinput` events) made at or after a time: the time
   * from the event to the page hearing that the first frame drawn after it was drawn, ms
   * (the benchmark's `typing-long`). Inputs no frame has followed yet are left out.
   *
   * @param sinceMs - The time, ms on the page's clock, compared with each event's time stamp.
   * @returns The latencies, in the order the inputs were made.
   */
  keyInputLatenciesMs(sinceMs: number): readonly number[];
  /**
   * How many keyboard inputs made at or after a time no frame has followed yet: the
   * inputs {@link EngineHarness.keyInputLatenciesMs} still leaves out, so a caller can wait for
   * them rather than lose the slowest.
   *
   * @param sinceMs - The time, ms on the page's clock, compared with each event's time stamp.
   * @returns The count.
   */
  pendingKeyInputs(sinceMs: number): number;
  /**
   * Each family's loading state in the page's font registry, without starting a load (
   * the benchmark's `text-first-paint`): `idle` before anything asked for it (or before the
   * page's fonts start), `loading`, `ready` once every face is installed, `failed`, or `missing`
   * when no catalogue has it.
   *
   * @param families - The stored family names.
   * @returns The state of each, by family.
   */
  fontStatus(
    families: readonly string[],
  ): Readonly<Record<string, 'idle' | 'loading' | 'ready' | 'failed' | 'missing'>>;
  /**
   * Applies a document change to the engine alone: the page's document, and so the select
   * tool, never sees it (the benchmark harness draws its boards this way).
   *
   * @param changes - The change, as plain data.
   */
  applyChangeSet(changes: SerializableChangeSet): void;
  /**
   * Writes board objects into the page's document, in one transaction with the system origin,
   * as they are: the select tool can then pick and move them, and the document sends them to
   * the engine (the benchmark harness's select drags). It takes typed board objects
   * or plain JSON (a scenario's fixture crosses `page.evaluate` as JSON, its ids and
   * colours plain strings and arrays); the document validates each. The typed form is listed
   * last, so `Parameters<EngineHarness['loadDocument']>` reads it, as fixtures that build board
   * objects do.
   *
   * @throws {Error} When the document refuses an object, or the engine has no document.
   */
  readonly loadDocument: ((objects: readonly object[]) => void) &
    ((objects: readonly BoardObject[]) => void);
  /**
   * Sets the camera.
   *
   * @param camera - The camera.
   */
  setCamera(camera: Camera): void;
  /**
   * Shows or hides the dot grid in the engine alone (the benchmark harness's zoom sweeps run
   * with it on); the shell's own preference is not changed.
   *
   * @param isVisible - Whether the grid shows.
   */
  setGridVisible(isVisible: boolean): void;
  /**
   * Shows a trace tint in the engine alone, through the shell's overlay (the benchmark
   * harness's sweep under a sheet over a thousand objects); the shell's own sheets are not
   * changed.
   *
   * @param model - The sheets, world units.
   */
  showTraceTint(model: TraceTintModel): void;
  /**
   * Draws objects' theme-aware `ink` in a theme in the engine alone (the benchmark's theme switch
   * on ink strokes), with the themes' ink tokens; the shell's theme is not changed.
   *
   * @param theme - The theme.
   */
  setTheme(theme: 'light' | 'dark'): void;
  /**
   * Animates the camera on the engine's own frames.
   *
   * @param camera - Where it ends.
   * @param durationMs - How long it takes, ms.
   */
  animateCamera(camera: Camera, durationMs: number): void;
  /**
   * Starts recording frame statistics where the engine runs, as a new run (the benchmark
   * harness, before each scenario).
   *
   * @param capacity - Frames the statistics keep; size it to the scenario.
   */
  startFrameStats(capacity: number): void;
  /**
   * Reads the statistics of the frames drawn since they started: CPU ms per stage, GPU ms per
   * timed pass, per-frame counters, GPU memory by category.
   *
   * @returns The summary, plain data.
   */
  readFrameStats(): Promise<BenchmarkSample>;
  /**
   * Reads indexed candidates at a frame barrier for preview feasibility diagnostics.
   * Does not certify document identity or font/image readiness.
   *
   * @param bounds - World-space coverage.
   * @returns Frame candidates; undefined for a host without projection reads.
   */
  readProjection?(bounds: WorldBounds): Promise<SceneProjection | undefined>;
  /** Stops recording frame statistics and removes the engine's stage timers. */
  stopFrameStats(): void;
  /**
   * Loses the engine's GPU device as a driver reset would: after a WebGPU loss the engine goes on
   * with WebGL2 on a fresh canvas, and `backendName` says so once it draws.
   */
  loseDeviceForTesting(): void;
  /**
   * Resolves once no stepped run holds the page's board: a benchmark's freeze window
   * ends after the last part of a large change, not at its first frame. Absent from a harness
   * built before it.
   *
   * @returns A promise that resolves when the board is idle.
   */
  whenStoreIdle?(): Promise<void>;
  /**
   * Resolves with the index of the first frame that includes every call the page made to the
   * engine before this one: a read barrier, so a frame report at or after it shows the
   * scene as sent. The latest frame's index when the host has no barrier.
   *
   * @returns The frame index.
   */
  acknowledgeFrame?(): Promise<number>;
  /**
   * Plays other people's reactions into the shell's own reactions channel (`?reactions=local`,
   *'s reactions burst), as the relay would fan them out. Absent without that channel.
   *
   * @param events - The reactions, in order.
   */
  receiveReactions?(events: readonly ReactionEvent[]): void;
}
