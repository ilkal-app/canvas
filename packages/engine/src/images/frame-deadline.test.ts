import { describe, expect, it } from 'vitest';

import { FrameDeadline } from './frame-deadline.js';

/**
 * A deadline over a timer the test runs by hand.
 *
 * @returns The deadline, its waits and how many frames it asked for.
 */
function setUp() {
  const waits: { delayMs: number; run: () => void; isStopped: boolean }[] = [];
  let frames = 0;
  const deadline = new FrameDeadline(
    (run, delayMs) => {
      const wait = { delayMs, run, isStopped: false };
      waits.push(wait);
      return () => {
        wait.isStopped = true;
      };
    },
    () => {
      frames += 1;
    },
  );
  return { deadline, waits, frames: () => frames };
}

describe('FrameDeadline', () => {
  it('asks for a frame once the earliest deadline asked for comes', () => {
    const { deadline, waits, frames } = setUp();
    deadline.request(Infinity, 0);
    expect(waits).toEqual([]);
    deadline.request(300, 100);
    deadline.request(400, 120);
    expect(waits.map(({ delayMs }) => delayMs)).toEqual([200]);
    deadline.request(150, 120);
    expect(waits.map(({ delayMs, isStopped }) => [delayMs, isStopped])).toEqual([
      [200, true],
      [30, false],
    ]);
    waits[1]?.run();
    expect(frames()).toBe(1);
    deadline.request(400, 150);
    expect(waits.at(-1)?.delayMs).toBe(250);
  });

  it('waits again for a later deadline once an earlier one has passed, and stops', () => {
    const { deadline, waits } = setUp();
    deadline.request(100, 0);
    deadline.request(200, 100);
    expect(waits.map(({ delayMs }) => delayMs)).toEqual([100, 100]);
    deadline.request(50, 120);
    expect(waits.at(-1)?.delayMs).toBe(0);
    deadline.stop();
    deadline.stop();
    expect(waits.at(-1)?.isStopped).toBe(true);
  });
});
