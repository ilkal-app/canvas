import { describe, expect, it } from 'vitest';

import type { EngineThreadPlatform } from './engine-host-platform.js';
import {
  frameSourceOf,
  PageFrameTicks,
  PageTickAnswers,
  withPageFrameTicks,
} from './page-frame-ticks.js';

/**
 * A worker platform whose own frames the test counts.
 *
 * @param hasAnimationFrames - What the platform says of its scope.
 * @returns The platform and the frames requested of it.
 */
function createPlatform(hasAnimationFrames: boolean | undefined): {
  platform: EngineThreadPlatform;
  ownFrames: ((timeMs: number) => void)[];
} {
  const ownFrames: ((timeMs: number) => void)[] = [];
  const platform = {
    hasAnimationFrames,
    now: () => 40,
    requestAnimationFrame: (callback: (timeMs: number) => void) => ownFrames.push(callback),
    cancelAnimationFrame: () => undefined,
  } as unknown as EngineThreadPlatform;
  return { platform, ownFrames };
}

describe('frameSourceOf', () => {
  it('takes the page ticks only where the scope is known to have no animation frames', () => {
    expect(frameSourceOf(false)).toBe('page-ticks');
    expect(frameSourceOf(true)).toBe('animation-frame');
    expect(frameSourceOf(undefined)).toBe('animation-frame');
  });
});

describe('withPageFrameTicks', () => {
  it('leaves a platform with animation frames, or that does not say, unchanged', () => {
    for (const has of [true, undefined]) {
      const { platform } = createPlatform(has);
      const framed = withPageFrameTicks(platform);
      expect(framed.platform).toBe(platform);
      expect(framed.ticks).toBeUndefined();
    }
  });

  it("runs a frameless worker's frames at the page's ticks, not its own timer", () => {
    const { platform, ownFrames } = createPlatform(false);
    const framed = withPageFrameTicks(platform);
    const asks: number[] = [];
    framed.ticks?.connect(() => asks.push(1));
    const times: number[] = [];
    framed.platform.requestAnimationFrame((timeMs) => times.push(timeMs));
    expect(asks).toHaveLength(1);
    framed.ticks?.tick(33);
    expect(times).toEqual([33]);
    expect(ownFrames).toHaveLength(0);
    expect(framed.platform.now()).toBe(40);
  });
});

describe('PageFrameTicks', () => {
  it('asks once per tick however many frames are requested, and skips cancelled ones', () => {
    const ticks = new PageFrameTicks();
    let asks = 0;
    ticks.connect(() => (asks += 1));
    const times: string[] = [];
    ticks.request((timeMs) => times.push(`a${String(timeMs)}`));
    const cancelled = ticks.request(() => times.push('cancelled'));
    ticks.request((timeMs) => times.push(`b${String(timeMs)}`));
    ticks.cancel(cancelled);
    expect(asks).toBe(1);
    ticks.tick(16);
    expect(times).toEqual(['a16', 'b16']);
    ticks.tick(32);
    expect(times).toEqual(['a16', 'b16']);
    expect(asks).toBe(1);
  });

  it('skips a frame cancelled by another frame of the same tick', () => {
    const ticks = new PageFrameTicks();
    ticks.connect(() => undefined);
    const ran: string[] = [];
    ticks.request(() => {
      ran.push('a');
      ticks.cancel(second);
    });
    const second = ticks.request(() => ran.push('b'));
    ticks.tick(16);
    expect(ran).toEqual(['a']);
  });

  it('asks again for a frame requested during a tick, for the next one', () => {
    const ticks = new PageFrameTicks();
    let asks = 0;
    ticks.connect(() => (asks += 1));
    const times: number[] = [];
    const frame = (timeMs: number): void => {
      times.push(timeMs);
      if (times.length < 2) ticks.request(frame);
    };
    ticks.request(frame);
    ticks.tick(8);
    expect(asks).toBe(2);
    ticks.tick(16);
    expect(times).toEqual([8, 16]);
  });

  it('holds requests made before it is connected and asks on connecting', () => {
    const ticks = new PageFrameTicks();
    ticks.request(() => undefined);
    let asks = 0;
    ticks.connect(() => (asks += 1));
    expect(asks).toBe(1);
  });
});

describe('PageTickAnswers', () => {
  it("posts one tick at the page's next frame however often it was asked", () => {
    const pageFrames: (() => void)[] = [];
    let posts = 0;
    const answers = new PageTickAnswers(
      () => (posts += 1),
      (callback) => pageFrames.push(callback),
    );
    answers.ask();
    answers.ask();
    expect(pageFrames).toHaveLength(1);
    expect(posts).toBe(0);
    pageFrames[0]?.();
    expect(posts).toBe(1);
    answers.ask();
    expect(pageFrames).toHaveLength(2);
  });
});
