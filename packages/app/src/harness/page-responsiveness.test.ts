// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EngineFrameReport } from '@canvas/engine';

import { PageResponsiveness } from './page-responsiveness.js';

function report(timestampsMs: readonly number[]): EngineFrameReport {
  return {
    frameIndex: 0,
    frameTimeMs: 0,
    camera: undefined,
    drawingBuffer: { widthPx: 4, heightPx: 2 },
    stats: {
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
    },
    pointerInputs: timestampsMs.map((timestampMs) => ({
      type: 'move',
      xPx: 0,
      yPx: 0,
      buttons: 1,
      pointerId: 1,
      timestampMs,
    })),
    hasPendingWork: false,
    isUsingJobWorkers: false,
  };
}

/** A PerformanceObserver stand-in that lets the test deliver long tasks. */
class FakeObserver {
  static supportedEntryTypes = ['longtask'];
  static instances: FakeObserver[] = [];
  readonly callback: (list: {
    getEntries: () => { startTime: number; duration: number }[];
  }) => void;
  observed: unknown[] = [];
  isDisconnected = false;

  constructor(callback: FakeObserver['callback']) {
    this.callback = callback;
    FakeObserver.instances.push(this);
  }

  observe(options: unknown): void {
    this.observed.push(options);
  }

  disconnect(): void {
    this.isDisconnected = true;
  }

  deliver(entries: { startTime: number; duration: number }[]): void {
    this.callback({ getEntries: () => entries });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeObserver.instances = [];
  FakeObserver.supportedEntryTypes = ['longtask'];
});

describe('PageResponsiveness', () => {
  it("keeps the page's long tasks from a time on, and stops observing", () => {
    vi.stubGlobal('PerformanceObserver', FakeObserver);
    const recorder = new PageResponsiveness();
    const [observer] = FakeObserver.instances;
    expect(observer?.observed).toEqual([{ type: 'longtask' }]);
    observer?.deliver([
      { startTime: 100, duration: 60 },
      { startTime: 300, duration: 80 },
    ]);
    expect(recorder.longTasks(200)).toEqual([{ startMs: 300, durationMs: 80 }]);
    recorder.stop();
    expect(observer?.isDisconnected).toBe(true);
  });

  it('records no long tasks where the browser has none, and still measures input latency', () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    const recorder = new PageResponsiveness();
    recorder.record(report([90, 95]), 110);
    recorder.record(report([]), 120);
    recorder.record(report([118]), 140);
    expect(recorder.longTasks(0)).toEqual([]);
    expect(recorder.inputLatenciesMs(0)).toEqual([20, 15, 22]);
    expect(recorder.inputLatenciesMs(130)).toEqual([22]);
    recorder.stop();
  });
});

it('records long animation frames separately when consecutive short tasks delay rendering', () => {
  FakeObserver.supportedEntryTypes = ['longtask', 'long-animation-frame'];
  vi.stubGlobal('PerformanceObserver', FakeObserver);
  const recorder = new PageResponsiveness();
  const observer = FakeObserver.instances.find((each) =>
    each.observed.some((entry) => (entry as { type: string }).type === 'long-animation-frame'),
  );
  expect(observer).toBeDefined();
  observer?.deliver([
    { startTime: 40, duration: 80 },
    { startTime: 200, duration: 65 },
  ]);
  expect(recorder.longAnimationFrames(100)).toEqual([{ startMs: 200, durationMs: 65 }]);
  expect(recorder.longTasks(0)).toEqual([]);
  recorder.stop();
  expect(FakeObserver.instances.every((each) => each.isDisconnected)).toBe(true);
});

describe('keyboard input-to-frame latency', () => {
  function keyAt(timestampMs: number): void {
    const event = new InputEvent('beforeinput', { bubbles: true });
    Object.defineProperty(event, 'timeStamp', { value: timestampMs });
    window.dispatchEvent(event);
  }

  it('settles two captured key inputs on the first later frame and filters by event time', () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    const recorder = new PageResponsiveness();
    keyAt(100);
    keyAt(120);
    recorder.record({ ...report([]), frameTimeMs: 130 }, 150);
    expect(recorder.keyInputLatenciesMs(0)).toEqual([50, 30]);
    expect(recorder.keyInputLatenciesMs(110)).toEqual([30]);
    recorder.stop();
  });

  it('keeps an input pending until a later frame report', () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    const recorder = new PageResponsiveness();
    keyAt(200);
    recorder.record({ ...report([]), frameTimeMs: 190 }, 210);
    expect(recorder.keyInputLatenciesMs(0)).toEqual([]);
    recorder.record({ ...report([]), frameTimeMs: 220 }, 230);
    expect(recorder.keyInputLatenciesMs(0)).toEqual([30]);
    recorder.stop();
  });
});
