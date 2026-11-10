import { describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/migration-registry.js';
import { runMigrations } from '../migrations/run-migrations.js';

import { resolveInk } from './color-tokens.js';
import { INK_COLORS } from './color.js';
import {
  isPaintOpaque,
  isPaintVisible,
  paintAverageColor,
  paintColorAt,
  type ResolvedPaint as Paint,
} from './paint.js';
import { isSameColor } from './text-style.js';

const linear = (alphas: readonly [number, number]): Paint => ({
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, color: [1, 0, 0, alphas[0]] },
    { offset: 1, color: [0, 0, 1, alphas[1]] },
  ],
});

describe('paint helpers', () => {
  it('returns a solid paint everywhere', () => {
    expect(paintColorAt([0.2, 0.4, 0.6, 1], 0.3, 0.9)).toEqual([0.2, 0.4, 0.6, 1]);
  });

  it('averages a gradient in premultiplied space, padding beyond its stops', () => {
    expect(paintAverageColor(linear([1, 1]))).toEqual([0.5, 0, 0.5, 1]);
    expect(paintAverageColor(linear([1, 0]))).toEqual([1, 0, 0, 0.5]);
    const padded: Paint = {
      type: 'radial',
      center: { x: 0.5, y: 0.5 },
      radius: 1,
      stops: [
        { offset: 0.5, color: [1, 1, 1, 1] },
        { offset: 0.5, color: [0, 0, 0, 1] },
      ],
    };
    expect(paintAverageColor(padded)).toEqual([0.5, 0.5, 0.5, 1]);
  });

  it('tells visible and opaque paints apart', () => {
    expect(isPaintVisible(null)).toBe(false);
    expect(isPaintVisible(linear([0, 0]))).toBe(false);
    expect(isPaintVisible(linear([0, 0.1]))).toBe(true);
    expect(isPaintOpaque(linear([1, 0.99]))).toBe(false);
    expect(isPaintOpaque(linear([1, 1]))).toBe(true);
    expect(isPaintOpaque([0, 0, 0, 1])).toBe(true);
  });

  it('resolves ink per theme and compares inkable colours', () => {
    expect(resolveInk('ink', 'dark')).toBe(INK_COLORS.dark);
    expect(resolveInk([0, 0, 0, 1], 'dark')).toEqual([0, 0, 0, 1]);
    expect(isSameColor('ink', 'ink')).toBe(true);
    expect(isSameColor('ink', [0, 0, 0, 1])).toBe(false);
    expect(isSameColor([0, 0, 0, 1], [0, 0, 0, 1])).toBe(true);
  });

  it('migrates a version 1 document to version 2 unchanged', () => {
    expect(MIGRATIONS.get(2)).toBeTypeOf('function');
    const fixture = {
      schemaVersion: 1,
      objects: [{ type: 'shape', fill: [1, 0, 0, 1], stroke: { color: [0, 0, 0, 1], width: 2 } }],
    };
    const before = structuredClone(fixture);
    expect(runMigrations(fixture, MIGRATIONS, 2)).toEqual({ ...before, schemaVersion: 2 });
    expect(fixture).toEqual(before);
  });
});

describe('the paint helpers at their edges', () => {
  const hard: Paint = {
    type: 'linear',
    angle: 0,
    stops: [
      { offset: 0.25, color: [1, 0, 0, 1] },
      { offset: 0.75, color: [0, 0, 1, 1] },
    ],
  };

  it('shows a stop exactly at its offset, and nothing for a gradient with no stops', () => {
    expect(paintColorAt(hard, 0.25, 0.5)).toEqual([1, 0, 0, 1]);
    const empty = { type: 'linear', angle: 0, stops: [] } as unknown as Paint;
    expect(paintColorAt(empty, 0.5, 0.5)).toEqual([0, 0, 0, 0]);
  });

  it('averages a solid to itself and calls null neither visible nor opaque', () => {
    expect(paintAverageColor([0.1, 0.2, 0.3, 0.4])).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(isPaintVisible(null)).toBe(false);
    expect(isPaintOpaque(null)).toBe(false);
  });
});
