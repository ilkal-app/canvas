import {
  overlayLayerModel,
  type EngineFrameReport,
  type EngineHost,
  type InputMark,
} from '@canvas/engine';
import type { BoardObject } from '@canvas/schema';

import { TRACE_TINT_LAYER } from '../engine/shell-overlay.js';
import { pageFontStatus } from '../text-input/page-fonts.js';
import { inkColorsOfThemes } from '../theme/canvas-background.js';

import type { EngineHarness, EngineHarnessCanvas } from './engine-harness.js';
import { InputCompletions, transferTimingsSince } from './input-completions.js';
import { InputMarks } from './input-marks.js';
import { PageResponsiveness } from './page-responsiveness.js';

/** How many frame reports the harness keeps: about 16 s at 60 Hz. */
const KEPT_FRAMES = 1_000;

/**
 * Keeps the host's latest frame reports and feeds them to the page's responsiveness record.
 *
 * @param host - The running engine.
 * @param responsiveness - The page's responsiveness record.
 * @returns The reports so far, oldest first, and a way to stop recording.
 */
function recordFrames(
  host: EngineHost,
  responsiveness: PageResponsiveness,
): { readonly frames: readonly EngineFrameReport[]; readonly stop: () => void } {
  const recording = {
    frames: [] as EngineFrameReport[],
    stop: host.onFrame((report) => {
      recording.frames.push(report);
      if (recording.frames.length > KEPT_FRAMES)
        recording.frames = recording.frames.slice(-KEPT_FRAMES);
      responsiveness.record(report, performance.now());
    }),
  };
  return recording;
}

/** The harness members that read the page's own measures, beside the engine's. */
type PageMeasures = Pick<
  EngineHarness,
  | 'pageLongAnimationFrames'
  | 'pageLongTasks'
  | 'canObserveLongTasks'
  | 'canObserveLongAnimationFrames'
  | 'inputLatenciesMs'
  | 'armInputMarks'
  | 'inputCompletions'
  | 'transferTimings'
  | 'keyInputLatenciesMs'
  | 'pendingKeyInputs'
>;

/**
 * The harness's page measures: long tasks and animation frames (and whether the browser reports
 * them), input latencies, marked inputs' GPU completions and transfer hops.
 *
 * @param responsiveness - The page's responsiveness record.
 * @param completions - The marked inputs' completions.
 * @param marks - The input marks.
 * @param framesOf - Reads the recorded frame reports (the record is replaced as it is trimmed).
 * @returns The members.
 */
function pageMeasures(
  responsiveness: PageResponsiveness,
  completions: InputCompletions,
  marks: InputMarks,
  framesOf: () => readonly EngineFrameReport[],
): PageMeasures {
  return {
    pageLongAnimationFrames: (sinceMs) => responsiveness.longAnimationFrames(sinceMs),
    pageLongTasks: (sinceMs) => responsiveness.longTasks(sinceMs),
    canObserveLongTasks: responsiveness.canObserveLongTasks,
    canObserveLongAnimationFrames: responsiveness.canObserveLongAnimationFrames,
    inputLatenciesMs: (sinceMs) => responsiveness.inputLatenciesMs(sinceMs),
    armInputMarks: marks.arm.bind(marks),
    inputCompletions: (sinceMs) => completions.since(sinceMs),
    transferTimings: (sinceMs) => transferTimingsSince(framesOf(), sinceMs),
    keyInputLatenciesMs: (sinceMs) => responsiveness.keyInputLatenciesMs(sinceMs),
    pendingKeyInputs: (sinceMs) => responsiveness.pendingKeyInputs(sinceMs),
  };
}

/**
 * Attaches an {@link EngineHarness} for `host` to the canvas it draws into, as `engineHarness`.
 * Only harness builds call it (the default shell and the standalone page with `?engine=`).
 *
 * @param host - The running engine.
 * @param canvas - Its canvas.
 * @param loadDocument - Writes board objects into the page's document; without it the harness's
 *   `loadDocument` throws.
 * @param markInput - Sends an input mark after the page's queued scene (the mount's view);
 *   `host.markInput` by default.
 * @param whenStoreIdle - Resolves once no stepped run holds the page's board; at once
 *   by default.
 * @returns Detaches the harness and stops recording.
 */
export function attachEngineHarness(
  host: EngineHost,
  canvas: EngineHarnessCanvas,
  loadDocument?: (objects: readonly BoardObject[]) => void,
  markInput: (mark: InputMark) => void = (mark) => host.markInput?.(mark),
  whenStoreIdle: () => Promise<void> = () => Promise.resolve(),
): () => void {
  const responsiveness = new PageResponsiveness();
  const completions = new InputCompletions(host);
  const marks = new InputMarks(markInput);
  const recording = recordFrames(host, responsiveness);
  const harness: EngineHarness = {
    hostKind: host.kind,
    // Read live: the engine switches to WebGL2 after a WebGPU loss.
    get backendName() {
      return host.capabilities.backendName;
    },
    get adapterName() {
      return host.capabilities.adapterName;
    },
    get isSoftwareAdapter() {
      return host.capabilities.isSoftwareAdapter;
    },
    get hasTimestampQuery() {
      return host.capabilities.hasTimestampQuery;
    },
    frames: () => [...recording.frames],
    ...pageMeasures(responsiveness, completions, marks, () => recording.frames),
    fontStatus: (families) =>
      Object.fromEntries(families.map((family) => [family, pageFontStatus(family)])),
    applyChangeSet: (changes) => {
      host.applyChangeSet(changes);
    },
    loadDocument: (objects) => {
      if (loadDocument === undefined) throw new Error('This engine has no document to load.');
      // Plain JSON from a page's caller: the document validates every object it writes.
      loadDocument(objects as readonly BoardObject[]);
    },
    setCamera: (camera) => {
      host.setCamera(camera);
    },
    animateCamera: (camera, durationMs) => {
      host.animateCamera(camera, durationMs);
    },
    setGridVisible: (isVisible) => {
      host.setGridVisible(isVisible);
    },
    showTraceTint: (model) => {
      host.setOverlay(overlayLayerModel(TRACE_TINT_LAYER, model));
    },
    setTheme: (theme) => {
      host.setTheme(theme, inkColorsOfThemes());
    },
    startFrameStats: (capacity) => {
      host.startFrameStats(capacity);
    },
    readFrameStats: () => host.readFrameStats(),
    readProjection: (bounds) => host.readProjection?.(bounds) ?? Promise.resolve(undefined),
    stopFrameStats: () => {
      host.stopFrameStats();
    },
    loseDeviceForTesting: () => {
      host.loseDeviceForTesting();
    },
    whenStoreIdle,
    acknowledgeFrame: () =>
      host.requestFrameAcknowledgement?.() ??
      Promise.resolve(recording.frames.at(-1)?.frameIndex ?? 0),
  };
  canvas.engineHarness = harness;
  return () => {
    recording.stop();
    responsiveness.stop();
    completions.stop();
    marks.stop();
    delete canvas.engineHarness;
  };
}
