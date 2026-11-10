import { describe, expect, it } from 'vitest';

import { PIN_SIZE_PX } from './comment-card-position.js';
import { clusterPins, worldBoundsOf } from './comment-clusters.js';

describe('clusterPins', () => {
  it('keeps pins apart that do not overlap on screen', () => {
    const groups = clusterPins([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: PIN_SIZE_PX, y: 0 },
      { id: 'c', x: 0, y: PIN_SIZE_PX },
    ]);
    expect(groups.map((group) => group.ids)).toEqual([['a'], ['b'], ['c']]);
  });

  it('merges pins whose boxes overlap into one group at its first pin', () => {
    const groups = clusterPins([
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 110, y: 95 },
      { id: 'c', x: 300, y: 300 },
      { id: 'd', x: 90, y: 120 },
    ]);
    expect(groups).toEqual([
      { ids: ['a', 'b', 'd'], x: 100, y: 100 },
      { ids: ['c'], x: 300, y: 300 },
    ]);
  });

  it('merges a chain of pins that overlap one another, not only the first', () => {
    const groups = clusterPins([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 20, y: 0 },
      { id: 'c', x: 40, y: 0 },
      { id: 'd', x: 200, y: 0 },
    ]);
    expect(groups.map((group) => group.ids)).toEqual([['a', 'b', 'c'], ['d']]);
  });

  it('splits the same pins again once they are far enough apart (zoomed in)', () => {
    const at = (zoom: number) =>
      clusterPins([
        { id: 'a', x: 10 * zoom, y: 10 * zoom },
        { id: 'b', x: 20 * zoom, y: 10 * zoom },
      ]).length;
    expect(at(1)).toBe(1);
    expect(at(4)).toBe(2);
  });

  it('puts 500 pins in one place in one group, and 500 apart in 500', () => {
    const together = [...Array.from({ length: 500 }).keys()].map((index) => ({
      id: String(index),
      x: 50 + (index % 5),
      y: 50,
    }));
    expect(clusterPins(together)).toHaveLength(1);
    const apart = [...Array.from({ length: 500 }).keys()].map((index) => ({
      id: String(index),
      x: (index % 25) * 40,
      y: Math.floor(index / 25) * 40,
    }));
    expect(clusterPins(apart)).toHaveLength(500);
  });

  it('does not mutate its input', () => {
    const pins = Object.freeze([Object.freeze({ id: 'a', x: 0, y: 0 })]);
    expect(() => clusterPins(pins)).not.toThrow();
  });
});

describe('worldBoundsOf', () => {
  it('bounds the points', () => {
    expect(
      worldBoundsOf([
        { x: 3, y: -1 },
        { x: -2, y: 4 },
      ]),
    ).toEqual({ minX: -2, minY: -1, maxX: 3, maxY: 4 });
  });
});
