import { describe, expect, it } from 'vitest';

import { WorkQueue } from './work-queue.js';

/**
 * Creates a frozen clock that advances only when a job says it took time.
 *
 * @returns The clock and a way to move it forward, in ms.
 */
function createFakeClock(): { now: () => number; advance: (ms: number) => void } {
  let timeMs = 1000;
  return {
    now: () => timeMs,
    advance: (ms) => {
      timeMs += ms;
    },
  };
}

interface TimedJob {
  readonly name: string;
  readonly costMs: number;
}

function createTimedQueue(clock: ReturnType<typeof createFakeClock>): {
  queue: WorkQueue<TimedJob>;
  ran: string[];
} {
  const ran: string[] = [];
  const queue = new WorkQueue<TimedJob>(({ item }) => {
    ran.push(item.name);
    clock.advance(item.costMs);
  });
  return { queue, ran };
}

describe('WorkQueue.drain', () => {
  it('runs jobs in priority order until the per-frame budget is spent', () => {
    const clock = createFakeClock();
    const { queue, ran } = createTimedQueue(clock);
    queue.enqueue({ name: 'prefetch', costMs: 2 }, 'prefetch');
    queue.enqueue({ name: 'visible-1', costMs: 2 }, 'visible');
    queue.enqueue({ name: 'near', costMs: 2 }, 'near');
    queue.enqueue({ name: 'visible-2', costMs: 2 }, 'visible');

    const report = queue.drain(5, clock.now);

    // 0 ms, 2 ms and 4 ms are under the 5 ms budget, so three jobs start; at 6 ms the drain stops.
    expect(ran).toEqual(['visible-1', 'visible-2', 'near']);
    expect(report).toEqual({ jobsRun: 3, elapsedMs: 6, jobsRemaining: 1 });
  });

  it('spreads a large batch across frames instead of stalling one frame', () => {
    const clock = createFakeClock();
    const { queue, ran } = createTimedQueue(clock);
    for (let index = 0; index < 500; index += 1) {
      queue.enqueue({ name: `text-${String(index)}`, costMs: 0.16 }, 'visible');
    }

    const frames: number[] = [];
    while (queue.size > 0) frames.push(queue.drain(4, clock.now).jobsRun);

    expect(ran).toHaveLength(500);
    expect(ran[0]).toBe('text-0');
    expect(ran[499]).toBe('text-499');
    expect(frames.length).toBeGreaterThan(15);
    expect(Math.max(...frames)).toBeLessThanOrEqual(26);
  });

  it('always lets a started job finish, so one slow job can overrun the budget', () => {
    const clock = createFakeClock();
    const { queue, ran } = createTimedQueue(clock);
    queue.enqueue({ name: 'slow', costMs: 30 }, 'visible');
    queue.enqueue({ name: 'next', costMs: 1 }, 'visible');

    const report = queue.drain(4, clock.now);

    expect(ran).toEqual(['slow']);
    expect(report).toEqual({ jobsRun: 1, elapsedMs: 30, jobsRemaining: 1 });
  });

  it('runs nothing with a zero budget', () => {
    const clock = createFakeClock();
    const { queue, ran } = createTimedQueue(clock);
    queue.enqueue({ name: 'a', costMs: 1 }, 'visible');

    expect(queue.drain(0, clock.now)).toEqual({ jobsRun: 0, elapsedMs: 0, jobsRemaining: 1 });
    expect(ran).toEqual([]);
  });

  it('runs everything with an infinite budget', () => {
    const clock = createFakeClock();
    const { queue, ran } = createTimedQueue(clock);
    queue.enqueue({ name: 'a', costMs: 100 }, 'near');
    queue.enqueue({ name: 'b', costMs: 100 }, 'prefetch');

    expect(queue.drain(Infinity, clock.now).jobsRun).toBe(2);
    expect(ran).toEqual(['a', 'b']);
  });

  it('never runs a job cancelled before the drain', () => {
    const clock = createFakeClock();
    const { queue, ran } = createTimedQueue(clock);
    const id = queue.enqueue({ name: 'stale-layout', costMs: 1 }, 'visible');
    queue.enqueue({ name: 'fresh-layout', costMs: 1 }, 'visible');
    queue.cancel(id);

    queue.drain(10, clock.now);

    expect(ran).toEqual(['fresh-layout']);
  });

  it('honours re-prioritisation between frames', () => {
    const clock = createFakeClock();
    const { queue, ran } = createTimedQueue(clock);
    queue.enqueue({ name: 'left', costMs: 1 }, 'visible');
    queue.enqueue({ name: 'right', costMs: 1 }, 'prefetch');

    queue.reprioritize(({ item: { name } }) => (name === 'right' ? 'visible' : 'prefetch'));
    queue.drain(1, clock.now);

    expect(ran).toEqual(['right']);
  });

  it('removes a job before running it, so a throwing job stops the drain but not the queue', () => {
    const clock = createFakeClock();
    const ran: string[] = [];
    const queue = new WorkQueue<string>(({ item }) => {
      if (item === 'broken') throw new Error('layout failed');
      ran.push(item);
    });
    queue.enqueue('broken', 'visible');
    queue.enqueue('healthy', 'visible');

    expect(() => queue.drain(10, clock.now)).toThrow('layout failed');
    expect(queue.size).toBe(1);
    queue.drain(10, clock.now);
    expect(ran).toEqual(['healthy']);
  });

  it('rejects a negative or NaN budget', () => {
    const queue = new WorkQueue<string>(() => undefined);

    expect(() => queue.drain(-1, () => 0)).toThrow(RangeError);
    expect(() => queue.drain(Number.NaN, () => 0)).toThrow(RangeError);
  });
});
