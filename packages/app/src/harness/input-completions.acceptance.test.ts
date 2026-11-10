// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import type { EngineHost, EngineFrameReport, InputMark } from '@canvas/engine';

import { attachEngineHarness } from './attach-engine-harness.js';
import type { EngineHarnessCanvas } from './engine-harness.js';

afterEach(() => vi.restoreAllMocks());

const mark = (id: number, timestampMs: number): InputMark => ({
  kind: 'drag-end',
  id,
  timestampMs,
  markedMs: timestampMs + 1,
});
interface Completion {
  frameIndex: number;
  frameTimeMs: number;
  marks: readonly InputMark[];
  hasPendingWork: boolean;
  completedMs: number;
}

function fixture() {
  const completionListeners = new Set<(event: Completion) => void>();
  const frameListeners = new Set<(report: EngineFrameReport) => void>();
  const host = {
    kind: 'worker',
    capabilities: {
      backendName: 'webgpu',
      adapterName: 'fake',
      isSoftwareAdapter: false,
      hasTimestampQuery: true,
    },
    onFrame: (listener: (report: EngineFrameReport) => void) => {
      frameListeners.add(listener);
      return () => {
        frameListeners.delete(listener);
      };
    },
    onInputsCompleted: (listener: (event: Completion) => void) => {
      completionListeners.add(listener);
      return () => {
        completionListeners.delete(listener);
      };
    },
  } as unknown as EngineHost;
  const canvas = document.createElement('canvas') as EngineHarnessCanvas;
  const detach = attachEngineHarness(host, canvas);
  const harness = canvas.engineHarness;
  if (!harness) throw new Error('Harness was not attached');
  const complete = (event: Completion) => {
    for (const listener of completionListeners) listener(event);
  };
  const frame = (report: EngineFrameReport) => {
    for (const listener of frameListeners) listener(report);
  };
  return { harness, detach, complete, frame, completionListeners };
}

it('records per-mark GPU completion latency and filters by page-clock receipt time', () => {
  vi.spyOn(performance, 'now').mockReturnValue(130);
  const f = fixture();
  f.complete({
    frameIndex: 2,
    frameTimeMs: 110,
    marks: [mark(1, 90), mark(2, 95)],
    hasPendingWork: true,
    completedMs: 120,
  });
  expect(f.harness.inputCompletions(0)).toEqual([
    { kind: 'drag-end', latencyMs: 30, frameTimeMs: 110, receivedMs: 130, hasPendingWork: true },
    { kind: 'drag-end', latencyMs: 25, frameTimeMs: 110, receivedMs: 130, hasPendingWork: true },
  ]);
  expect(f.harness.inputCompletions(131)).toEqual([]);
  f.detach();
  expect(f.completionListeners.size).toBe(0);
});

it('does not record the live ink hand-off mark as measured input', () => {
  vi.spyOn(performance, 'now').mockReturnValue(130);
  const f = fixture();
  f.complete({
    frameIndex: 2,
    frameTimeMs: 110,
    marks: [{ ...mark(1, 90), kind: 'ink-handoff' }, mark(2, 95)],
    hasPendingWork: false,
    completedMs: 120,
  });
  expect(f.harness.inputCompletions(0)).toEqual([
    { kind: 'drag-end', latencyMs: 25, frameTimeMs: 110, receivedMs: 130, hasPendingWork: false },
  ]);
  f.detach();
});

it('keeps only the last thousand completions', () => {
  const now = vi.spyOn(performance, 'now');
  const f = fixture();
  for (let id = 1; id <= 1002; id += 1) {
    now.mockReturnValue(id + 6);
    f.complete({
      frameIndex: id,
      frameTimeMs: id,
      marks: [mark(id, id)],
      hasPendingWork: false,
      completedMs: id + 5,
    });
  }
  expect(f.harness.inputCompletions(0)).toHaveLength(1000);
  expect(f.harness.inputCompletions(0)[0]?.receivedMs).toBe(9);
  f.detach();
});

it('exposes transfer timings from frame reports after the requested page-clock time', () => {
  const f = fixture();
  const base = {
    frameIndex: 1,
    frameTimeMs: 100,
    camera: undefined,
    drawingBuffer: { widthPx: 4, heightPx: 2 },
    stats: {} as EngineFrameReport['stats'],
    pointerInputs: [],
    hasPendingWork: false,
    isUsingJobWorkers: false,
  };
  f.frame({ ...base, transferMs: { pageToWorker: 3, workerToPage: 4 } });
  f.frame({
    ...base,
    frameIndex: 2,
    frameTimeMs: 200,
    transferMs: { pageToWorker: 5, workerToPage: 6 },
  });
  expect(f.harness.transferTimings(150)).toEqual([
    { frameTimeMs: 200, pageToWorkerMs: 5, workerToPageMs: 6 },
  ]);
  f.detach();
});
