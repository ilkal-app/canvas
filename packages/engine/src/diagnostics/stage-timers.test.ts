import { describe, expect, it, vi } from 'vitest';

import type { GpuBackend, GpuPassTiming } from '../gpu/gpu-backend.js';
import { CAMERA_UNIFORM_BYTE_LENGTH } from '../scene/camera-uniform.js';
import type { FrameContext } from '../scene/frame-context.js';

import { MemoryLedger } from './memory-ledger.js';
import { StageTimers } from './stage-timers.js';

// A controllable clock, in ms.
function fakeClock(): { read: () => number; advance: (ms: number) => void; reads: () => number } {
  let nowMs = 1000;
  let readCount = 0;
  return {
    read: () => {
      readCount += 1;
      return nowMs;
    },
    advance: (ms) => {
      nowMs += ms;
    },
    reads: () => readCount,
  };
}

interface BackendStub {
  readonly backend: GpuBackend;
  readonly collect: ReturnType<typeof vi.fn>;
  // Resolves the oldest pending `collectPassTimings` call.
  resolveNext(timings: readonly GpuPassTiming[]): Promise<void>;
}

// A backend that only reports timestamps and hands out pass timings when a test says so.
function backendStub(hasTimestampQuery: boolean): BackendStub {
  const pending: ((timings: readonly GpuPassTiming[]) => void)[] = [];
  const collect = vi.fn(
    () =>
      new Promise<readonly GpuPassTiming[]>((resolve) => {
        pending.push(resolve);
      }),
  );
  const backend = { capabilities: { hasTimestampQuery }, collectPassTimings: collect };
  return {
    backend: backend as unknown as GpuBackend,
    collect,
    resolveNext: async (timings) => {
      pending.shift()?.(timings);
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

// The parts of a frame context the stage timers read.
function contextOf(frameIndex: number, backend: GpuBackend, drawCalls = 0): FrameContext {
  return {
    frameIndex,
    timeMs: frameIndex * 16,
    backend,
    stats: { changedObjects: 3, bufferWrites: 2, uploadedBytes: 64, drawCalls },
    drawList: [
      {
        passName: 'solidRect',
        ranges: [
          { start: 0, count: 10 },
          { start: 20, count: 5 },
        ],
      },
    ],
    layers: [],
    passes: [],
    cameraUniform: { buffer: { byteLength: CAMERA_UNIFORM_BYTE_LENGTH } },
  } as unknown as FrameContext;
}

// Runs one frame of named stages, each taking its duration in ms.
function runFrame(
  timers: StageTimers,
  clock: ReturnType<typeof fakeClock>,
  context: FrameContext,
  stages: readonly (readonly [string, number])[],
): void {
  timers.beginFrame(context);
  for (const [name, durationMs] of stages) {
    timers.stageStarted(name);
    clock.advance(durationMs);
    timers.stageEnded(name);
  }
  timers.endFrame(context);
}

const STAGES = [
  ['collectChanges', 0.5],
  ['draw', 2],
  ['submit', 0.25],
] as const;

describe('StageTimers', () => {
  it('records each stage CPU time and the frame CPU time from the injected clock', () => {
    const clock = fakeClock();
    const timers = new StageTimers({ clock: clock.read });
    runFrame(timers, clock, contextOf(0, backendStub(false).backend), STAGES);
    const sample = timers.history.newest;
    expect(timers.history.stageNames).toEqual(['collectChanges', 'draw', 'submit']);
    expect(sample?.stageMs).toEqual([0.5, 2, 0.25]);
    expect(sample?.cpuMs).toBe(2.75);
    expect(sample).toMatchObject({ frameIndex: 0, timeMs: 0 });
  });

  it('counts time between stages in the frame time but in no stage', () => {
    const clock = fakeClock();
    const timers = new StageTimers({ clock: clock.read });
    const context = contextOf(0, backendStub(false).backend);
    timers.beginFrame(context);
    timers.stageStarted('a');
    clock.advance(1);
    timers.stageEnded('a');
    clock.advance(4);
    timers.stageStarted('b');
    clock.advance(1);
    timers.stageEnded('b');
    timers.endFrame(context);
    expect(timers.history.newest?.cpuMs).toBe(6);
    expect(timers.history.newest?.stageMs).toEqual([1, 1]);
  });

  it('copies the frame counters and counts the records the draw list covers', () => {
    const clock = fakeClock();
    const timers = new StageTimers({ clock: clock.read });
    runFrame(timers, clock, contextOf(0, backendStub(false).backend, 7), STAGES);
    expect(timers.history.newest).toMatchObject({
      drawCalls: 7,
      uploadedBytes: 64,
      bufferWrites: 2,
      changedObjects: 3,
      visibleRecords: 15,
    });
  });

  it('snapshots GPU memory by category at the end of the frame, scene reports included', () => {
    const clock = fakeClock();
    const ledger = new MemoryLedger();
    ledger.set('atlases', 'page 0', 4096);
    const timers = new StageTimers({ clock: clock.read, ledger });
    expect(timers.ledger).toBe(ledger);
    runFrame(timers, clock, contextOf(0, backendStub(false).backend), STAGES);
    expect(timers.history.newest?.memoryBytes).toEqual([
      0,
      4096,
      0,
      0,
      CAMERA_UNIFORM_BYTE_LENGTH,
      0,
    ]);
  });

  it('leaves no entry for a frame that never ended, as when a stage throws', () => {
    const clock = fakeClock();
    const timers = new StageTimers({ clock: clock.read });
    const { backend } = backendStub(false);
    timers.beginFrame(contextOf(0, backend));
    timers.stageStarted('draw');
    timers.stageEnded('draw');
    expect(timers.history.size).toBe(0);
    runFrame(timers, clock, contextOf(1, backend), STAGES);
    expect(timers.history.size).toBe(1);
    expect(timers.history.newest?.frameIndex).toBe(1);
  });

  it('ignores stage reports outside a frame without reading the clock', () => {
    const clock = fakeClock();
    const timers = new StageTimers({ clock: clock.read });
    timers.stageStarted('draw');
    timers.stageEnded('draw');
    timers.endFrame(contextOf(0, backendStub(false).backend));
    expect(clock.reads()).toBe(0);
    expect(timers.history.size).toBe(0);
  });

  it('reads the clock twice per stage and nothing else', () => {
    const clock = fakeClock();
    const timers = new StageTimers({ clock: clock.read });
    runFrame(timers, clock, contextOf(0, backendStub(false).backend), STAGES);
    expect(clock.reads()).toBe(2 * STAGES.length);
  });

  it('never asks for pass timings when the backend has no timestamp queries', () => {
    const clock = fakeClock();
    const stub = backendStub(false);
    const timers = new StageTimers({ clock: clock.read });
    runFrame(timers, clock, contextOf(0, stub.backend), STAGES);
    expect(stub.collect).not.toHaveBeenCalled();
    expect(timers.history.newest?.passGpuMs).toEqual([]);
  });

  it('attributes GPU pass times to the frame that submitted them when they resolve', async () => {
    const clock = fakeClock();
    const stub = backendStub(true);
    const timers = new StageTimers({ clock: clock.read });
    runFrame(timers, clock, contextOf(0, stub.backend), STAGES);
    runFrame(timers, clock, contextOf(1, stub.backend), STAGES);
    expect(stub.collect).toHaveBeenCalledTimes(2);
    expect(timers.history.at(0).passGpuMs).toEqual([]);
    await stub.resolveNext([{ label: 'scene', durationMs: 3 }]);
    await stub.resolveNext([{ label: 'scene', durationMs: 5 }]);
    expect(timers.history.passLabels).toEqual(['scene']);
    expect(timers.history.at(0).passGpuMs).toEqual([3]);
    expect(timers.history.at(1).passGpuMs).toEqual([5]);
  });

  it('ignores the pass timings collected after a gap in frames, which hold a backlog', async () => {
    const clock = fakeClock();
    const stub = backendStub(true);
    const timers = new StageTimers({ clock: clock.read });
    runFrame(timers, clock, contextOf(0, stub.backend), STAGES);
    // Frames 1 to 4 ran untimed; the backend kept their passes, and frame 5 collects them all.
    runFrame(timers, clock, contextOf(5, stub.backend), STAGES);
    runFrame(timers, clock, contextOf(6, stub.backend), STAGES);
    await stub.resolveNext([{ label: 'scene', durationMs: 3 }]);
    await stub.resolveNext([
      { label: 'scene', durationMs: 3 },
      { label: 'scene', durationMs: 3 },
      { label: 'scene', durationMs: 3 },
      { label: 'scene', durationMs: 3 },
      { label: 'scene', durationMs: 3 },
    ]);
    await stub.resolveNext([{ label: 'scene', durationMs: 4 }]);
    expect(stub.collect).toHaveBeenCalledTimes(3);
    expect(timers.history.at(0).passGpuMs).toEqual([3]);
    expect(timers.history.at(1).passGpuMs.every(Number.isNaN)).toBe(true);
    expect(timers.history.at(2).passGpuMs).toEqual([4]);
  });

  it('ignores the pass timings collected after an abandoned frame', async () => {
    const clock = fakeClock();
    const stub = backendStub(true);
    const timers = new StageTimers({ clock: clock.read });
    runFrame(timers, clock, contextOf(0, stub.backend), STAGES);
    timers.beginFrame(contextOf(1, stub.backend));
    runFrame(timers, clock, contextOf(1, stub.backend), STAGES);
    await stub.resolveNext([{ label: 'scene', durationMs: 3 }]);
    await stub.resolveNext([{ label: 'scene', durationMs: 9 }]);
    expect(timers.history.at(0).passGpuMs).toEqual([3]);
    expect(timers.history.at(1).passGpuMs.every(Number.isNaN)).toBe(true);
  });

  it('ignores the first collection when timing starts on a renderer that already ran', async () => {
    const clock = fakeClock();
    const stub = backendStub(true);
    const timers = new StageTimers({ clock: clock.read });
    runFrame(timers, clock, contextOf(30, stub.backend), STAGES);
    await stub.resolveNext([{ label: 'scene', durationMs: 90 }]);
    expect(timers.history.newest?.passGpuMs.every(Number.isNaN)).toBe(true);
  });

  it('adds up passes that share a label within one frame', () => {
    const timers = new StageTimers({ clock: fakeClock().read });
    const clock = fakeClock();
    runFrame(timers, clock, contextOf(4, backendStub(false).backend), STAGES);
    const isRecorded = timers.recordPassTimings(4, [
      { label: 'overlay', durationMs: 0.5 },
      { label: 'scene', durationMs: 2 },
      { label: 'overlay', durationMs: 0.25 },
    ]);
    expect(isRecorded).toBe(true);
    expect(timers.history.passLabels).toEqual(['overlay', 'scene']);
    expect(timers.history.newest?.passGpuMs).toEqual([0.75, 2]);
  });

  it('drops pass times for a frame the history no longer holds', () => {
    const clock = fakeClock();
    const timers = new StageTimers({ clock: clock.read, capacity: 1 });
    const { backend } = backendStub(false);
    runFrame(timers, clock, contextOf(0, backend), STAGES);
    runFrame(timers, clock, contextOf(1, backend), STAGES);
    expect(timers.recordPassTimings(0, [{ label: 'scene', durationMs: 1 }])).toBe(false);
  });

  it('keeps recording when the backend fails to resolve pass timings', async () => {
    const clock = fakeClock();
    const failing = {
      capabilities: { hasTimestampQuery: true },
      collectPassTimings: () => Promise.reject(new Error('device lost')),
    } as unknown as GpuBackend;
    const timers = new StageTimers({ clock: clock.read });
    runFrame(timers, clock, contextOf(0, failing), STAGES);
    await Promise.resolve();
    runFrame(timers, clock, contextOf(1, failing), STAGES);
    expect(timers.history.size).toBe(2);
  });

  it('reuses the same sample slots and arrays once the history is full', () => {
    const clock = fakeClock();
    const timers = new StageTimers({ clock: clock.read, capacity: 2 });
    const { backend } = backendStub(false);
    const slots = new Set<object>();
    const arrays = new Set<object>();
    for (let frameIndex = 0; frameIndex < 12; frameIndex += 1) {
      runFrame(timers, clock, contextOf(frameIndex, backend), STAGES);
      const sample = timers.history.newest;
      if (sample) {
        slots.add(sample);
        arrays.add(sample.stageMs);
        arrays.add(sample.memoryBytes);
      }
    }
    expect(slots.size).toBe(3);
    expect(arrays.size).toBe(6);
    expect(timers.history.newest?.stageMs).toHaveLength(STAGES.length);
  });

  it('numbers a stage that appears later after the others, blank in earlier frames', () => {
    const clock = fakeClock();
    const timers = new StageTimers({ clock: clock.read });
    const { backend } = backendStub(false);
    runFrame(timers, clock, contextOf(0, backend), [['draw', 1]]);
    runFrame(timers, clock, contextOf(1, backend), [
      ['segments', 0.5],
      ['draw', 1],
    ]);
    expect(timers.history.stageNames).toEqual(['draw', 'segments']);
    expect(timers.history.at(0).stageMs).toEqual([1]);
    expect(timers.history.at(1).stageMs).toEqual([1, 0.5]);
  });
});
