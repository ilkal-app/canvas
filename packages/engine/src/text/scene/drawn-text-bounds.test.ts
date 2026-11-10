import { describe, expect, it, vi } from 'vitest';

import type { Rgba } from '@canvas/schema';

import { worldTransformOf } from '../../scene/world-transform.js';

import { textObject } from './__fixtures__/text-objects.js';
import { drawnTextBounds } from './drawn-text-bounds.js';
import type { OrderedGlyphQuads } from './ordered-glyph-quads.js';
import type { TextObjectEntry } from './text-object-entry.js';
import { textPlacementOf } from './text-placement.js';

function entryWith(quads: OrderedGlyphQuads): TextObjectEntry {
  const object = textObject('label', 'A');
  const geometry = textPlacementOf(object);
  return {
    target: { object, transform: worldTransformOf(object, { get: () => undefined }) },
    geometry,
    quads,
    builtLayout: undefined,
    isStale: false,
    isGreek: false,
  };
}

describe('drawn text bounds', () => {
  it('reads local quads once and reuses their union through moves and rotations', () => {
    const read = vi.fn(() => [
      undefined,
      {
        pageId: 0,
        quad: {
          x: 2,
          y: -4,
          width: 10,
          height: 8,
          u0: 0,
          v0: 0,
          u1: 1,
          v1: 1,
          color: [0, 0, 0, 1] as Rgba,
        },
      },
    ]);
    const quads = {
      get quads() {
        return read();
      },
      tiers: [],
      isComplete: true,
      vectorRuns: [],
    };
    const entry = entryWith(quads);
    expect(drawnTextBounds(entry)).toEqual({ minX: 2, minY: -4, maxX: 12, maxY: 4 });
    const object = { ...entry.target.object, x: 100, rotation: Math.PI / 2 };
    entry.target = { object, transform: worldTransformOf(object, { get: () => undefined }) };
    const rotated = drawnTextBounds(entry);
    expect(rotated?.minX).toBeCloseTo(96);
    expect(rotated?.minY).toBeCloseTo(2);
    expect(rotated?.maxX).toBeCloseTo(104);
    expect(rotated?.maxY).toBeCloseTo(12);
    expect(read).toHaveBeenCalledTimes(1);
    entry.quads = { quads: [], tiers: [], isComplete: true, vectorRuns: [] };
    expect(drawnTextBounds(entry)).toBeUndefined();
    entry.quads = undefined;
    expect(drawnTextBounds(entry)).toBeUndefined();
  });
});
