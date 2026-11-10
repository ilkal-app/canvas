import { expect, it } from 'vitest';

import { HarnessFrameScheduler } from './harness-frame-scheduler.js';

function fixture(): {
  readonly frames: Map<number, (timeMs: number) => void>;
  readonly scheduler: HarnessFrameScheduler;
} {
  const frames = new Map<number, (timeMs: number) => void>();
  let next = 0;
  const scheduler = new HarnessFrameScheduler({
    now: () => 42,
    requestAnimationFrame: (callback) => {
      const id = next++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (handle) => {
      frames.delete(handle);
    },
  });
  return { frames, scheduler };
}

it('flushes once at the frozen timestamp and cancels the native frame', () => {
  const { frames, scheduler } = fixture();
  const times: number[] = [];
  scheduler.requestAnimationFrame((time) => times.push(time));
  scheduler.flush();
  scheduler.flush();
  expect(times).toEqual([42]);
  expect(frames.size).toBe(0);
});

it('leaves follow-on frames for the next explicit flush', () => {
  const { scheduler } = fixture();
  const times: number[] = [];
  scheduler.requestAnimationFrame((time) => {
    times.push(time);
    scheduler.requestAnimationFrame((next) => times.push(next));
  });
  scheduler.flush();
  expect(times).toEqual([42]);
  scheduler.flush();
  expect(times).toEqual([42, 42]);
});

it('does not revive a cancelled frame', () => {
  const { frames, scheduler } = fixture();
  let calls = 0;
  const id = scheduler.requestAnimationFrame(() => calls++);
  scheduler.cancelAnimationFrame(id);
  scheduler.flush();
  expect(calls).toBe(0);
  expect(frames.size).toBe(0);
});

it('does not repeat a frame already delivered by normal RAF', () => {
  const { frames, scheduler } = fixture();
  const times: number[] = [];
  const id = scheduler.requestAnimationFrame((time) => times.push(time));
  frames.get(id)?.(123);
  scheduler.flush();
  expect(times).toEqual([123]);
});

it('honors cancellation of another callback during a flush', () => {
  const { scheduler } = fixture();
  let calls = 0;
  let second = 0;
  scheduler.requestAnimationFrame(() => {
    scheduler.cancelAnimationFrame(second);
  });
  second = scheduler.requestAnimationFrame(() => calls++);
  scheduler.flush();
  expect(calls).toBe(0);
});

it('does not let a callback recursively drain its follow-on frame', () => {
  const { scheduler } = fixture();
  let calls = 0;
  scheduler.requestAnimationFrame(() => {
    calls += 1;
    scheduler.requestAnimationFrame(() => {
      calls += 1;
    });
    scheduler.flush();
  });
  scheduler.flush();
  expect(calls).toBe(1);
  scheduler.flush();
  expect(calls).toBe(2);
});

it('reads the underlying clock without advancing it, and flushes at that time', () => {
  let clockMs = 7;
  const frames = new Map<number, (timeMs: number) => void>();
  const scheduler = new HarnessFrameScheduler({
    now: () => clockMs,
    requestAnimationFrame: (callback) => {
      frames.set(frames.size, callback);
      return frames.size - 1;
    },
    cancelAnimationFrame: (handle) => {
      frames.delete(handle);
    },
  });
  expect(scheduler.now()).toBe(7);
  expect(scheduler.now()).toBe(7);
  clockMs = 19;
  expect(scheduler.now()).toBe(19);
  const times: number[] = [];
  scheduler.requestAnimationFrame((time) => times.push(time));
  scheduler.flush();
  expect(times).toEqual([scheduler.now()]);
});
