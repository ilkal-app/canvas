import { describe, expect, it } from 'vitest';

import { MAX_ZOOM, MIN_ZOOM } from '@canvas/engine';

import { steppedZoom, ZOOM_LEVELS } from './zoom-levels.js';

describe('ZOOM_LEVELS', () => {
  it('is the ladder from 10% to 3200%, ascending, inside the camera’s limits', () => {
    expect(ZOOM_LEVELS.map((level) => Math.round(level * 100))).toEqual([
      10, 25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500, 800, 1600, 3200,
    ]);
    for (let index = 1; index < ZOOM_LEVELS.length; index += 1) {
      expect(ZOOM_LEVELS[index]).toBeGreaterThan(ZOOM_LEVELS[index - 1] ?? Infinity);
    }
    expect(ZOOM_LEVELS[0]).toBeGreaterThan(MIN_ZOOM);
    expect(ZOOM_LEVELS.at(-1)).toBeLessThanOrEqual(MAX_ZOOM);
  });
});

describe('steppedZoom', () => {
  it('steps from a level to the next level up or down', () => {
    expect(steppedZoom(1, 'in')).toBe(1.1);
    expect(steppedZoom(1, 'out')).toBe(0.9);
    expect(steppedZoom(0.5, 'in')).toBe(0.67);
    expect(steppedZoom(0.5, 'out')).toBe(0.33);
    expect(steppedZoom(8, 'in')).toBe(16);
  });

  it('walks the whole ladder up from its first level and down from its last', () => {
    const up = [ZOOM_LEVELS[0] ?? 0];
    while (up.length < ZOOM_LEVELS.length) up.push(steppedZoom(up.at(-1) ?? 0, 'in'));
    expect(up).toEqual(ZOOM_LEVELS);
    const down = [ZOOM_LEVELS.at(-1) ?? 0];
    while (down.length < ZOOM_LEVELS.length) down.push(steppedZoom(down.at(-1) ?? 0, 'out'));
    expect(down).toEqual([...ZOOM_LEVELS].reverse());
  });

  it('goes from a zoom between two levels (after a pinch) to the nearer level that way', () => {
    expect(steppedZoom(1.37, 'in')).toBe(1.5);
    expect(steppedZoom(1.37, 'out')).toBe(1.25);
    expect(steppedZoom(0.6, 'in')).toBe(0.67);
    expect(steppedZoom(0.6, 'out')).toBe(0.5);
  });

  it('counts a zoom a rounding error off a level as on it', () => {
    expect(steppedZoom(1.0000000001, 'in')).toBe(1.1);
    expect(steppedZoom(0.9999999999, 'out')).toBe(0.9);
  });

  it('goes past the ladder’s ends to the camera’s limits, and stays at a limit', () => {
    expect(steppedZoom(32, 'in')).toBe(MAX_ZOOM);
    expect(steppedZoom(40, 'in')).toBe(MAX_ZOOM);
    expect(steppedZoom(MAX_ZOOM, 'in')).toBe(MAX_ZOOM);
    expect(steppedZoom(MAX_ZOOM, 'out')).toBe(32);
    expect(steppedZoom(0.1, 'out')).toBe(MIN_ZOOM);
    expect(steppedZoom(0.05, 'out')).toBe(MIN_ZOOM);
    expect(steppedZoom(MIN_ZOOM, 'out')).toBe(MIN_ZOOM);
    expect(steppedZoom(MIN_ZOOM, 'in')).toBe(0.1);
  });
});
