import { describe, expect, it } from 'vitest';

import {
  LEVEL_DOWN_RATIO,
  levelSize,
  LEVEL_UP_SLACK,
  pickLevel,
  requiredLongEdgePx,
} from './level-selection.js';

const LEVELS = [128, 512, 2048, 4096] as const;
const WHOLE = { x: 0, y: 0, width: 1, height: 1 };

describe('requiredLongEdgePx', () => {
  it('is the on-screen long edge in device pixels at DPR 1', () => {
    const size = { width: 400, height: 300 };
    const natural = { width: 4000, height: 3000 };

    expect(requiredLongEdgePx(size, natural, WHOLE, 1, 1)).toBe(400);
    expect(requiredLongEdgePx(size, natural, WHOLE, 0.5, 1)).toBe(200);
  });

  it('doubles at DPR 2', () => {
    const size = { width: 400, height: 300 };
    const natural = { width: 4000, height: 3000 };

    expect(requiredLongEdgePx(size, natural, WHOLE, 1, 2)).toBe(800);
  });

  it('asks for the whole image at the resolution its crop is shown at', () => {
    const size = { width: 200, height: 300 };
    const natural = { width: 4000, height: 3000 };
    const leftHalf = { x: 0, y: 0, width: 0.5, height: 1 };

    // The crop shows half the width in 200 px, so the whole width needs 400 px.
    expect(requiredLongEdgePx(size, natural, leftHalf, 1, 1)).toBe(400);
  });

  it('takes the tighter axis when the box stretches the image', () => {
    const size = { width: 100, height: 400 };
    const natural = { width: 1000, height: 500 };

    // Height 400 px at the natural aspect needs a width of 800, the long edge.
    expect(requiredLongEdgePx(size, natural, WHOLE, 1, 1)).toBe(800);
  });

  it('needs nothing for an empty box', () => {
    expect(
      requiredLongEdgePx({ width: 0, height: 0 }, { width: 10, height: 10 }, WHOLE, 1, 1),
    ).toBe(0);
  });
});

describe('pickLevel', () => {
  it('picks the smallest level that meets the requirement with no previous level', () => {
    expect(pickLevel(100, LEVELS, undefined)).toBe(128);
    expect(pickLevel(128, LEVELS, undefined)).toBe(128);
    expect(pickLevel(129, LEVELS, undefined)).toBe(512);
    expect(pickLevel(2000, LEVELS, undefined)).toBe(2048);
  });

  it('falls back to the largest level when none is large enough', () => {
    expect(pickLevel(9000, LEVELS, undefined)).toBe(4096);
  });

  it('picks the same levels at DPR 2 for half the zoom as at DPR 1', () => {
    const size = { width: 300, height: 200 };
    const natural = { width: 3000, height: 2000 };
    const atDpr1 = pickLevel(requiredLongEdgePx(size, natural, WHOLE, 2, 1), LEVELS, undefined);
    const atDpr2 = pickLevel(requiredLongEdgePx(size, natural, WHOLE, 1, 2), LEVELS, undefined);

    expect(atDpr1).toBe(2048);
    expect(atDpr2).toBe(2048);
  });

  it('keeps a smaller level while zooming in until it is more than the slack short', () => {
    const limit = 512 * (1 + LEVEL_UP_SLACK);

    expect(pickLevel(520, LEVELS, 512)).toBe(512);
    expect(pickLevel(limit, LEVELS, 512)).toBe(512);
    expect(pickLevel(limit + 1, LEVELS, 512)).toBe(2048);
  });

  it('keeps a larger level while zooming out until the smaller one has room to spare', () => {
    const limit = 512 * LEVEL_DOWN_RATIO;

    expect(pickLevel(500, LEVELS, 2048)).toBe(2048);
    expect(pickLevel(limit, LEVELS, 2048)).toBe(2048);
    expect(pickLevel(limit - 1, LEVELS, 2048)).toBe(512);
  });

  it('does not flip back and forth when the requirement wobbles around a level', () => {
    let level = pickLevel(505, LEVELS, undefined);
    const picked = [505, 520, 498, 530, 510, 540, 470].map((required) => {
      level = pickLevel(required, LEVELS, level);
      return level;
    });

    expect(picked).toEqual([512, 512, 512, 512, 512, 512, 512]);
  });

  it('jumps straight to the right level when the requirement moves far', () => {
    expect(pickLevel(3000, LEVELS, 128)).toBe(4096);
    expect(pickLevel(50, LEVELS, 4096)).toBe(128);
  });

  it('steps down to the smallest level with room to spare, not only the next one', () => {
    // 128 is too tight (110 > 128 × 0.8), 512 has room: drop from 2048 to 512.
    expect(pickLevel(110, LEVELS, 2048)).toBe(512);
  });

  it('forgets a previous level that is no longer available', () => {
    expect(pickLevel(500, [128, 2048], 512)).toBe(2048);
  });

  it('rejects an empty level list', () => {
    expect(() => pickLevel(100, [], undefined)).toThrow(RangeError);
  });
});

describe('levelSize', () => {
  it('scales the original to the long edge, keeping its aspect ratio', () => {
    expect(levelSize({ width: 8000, height: 6000 }, 512)).toEqual({ width: 512, height: 384 });
    expect(levelSize({ width: 2000, height: 3000 }, 128)).toEqual({ width: 85, height: 128 });
  });

  it('never makes a side thinner than a pixel', () => {
    expect(levelSize({ width: 10_000, height: 10 }, 128)).toEqual({ width: 128, height: 1 });
  });
});
