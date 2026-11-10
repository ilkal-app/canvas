import { describe, expect, it } from 'vitest';

import { id, layeredInput } from './__fixtures__/layered-board.js';
import { compositesOf, EVERYWHERE, isSameTables, structureOf } from './layer-structure.js';

describe('layer structure', () => {
  it('finds the layers innermost first, their parents and each rank’s window', () => {
    const structure = structureOf(layeredInput(), undefined);
    expect(structure.layers.map(({ id: layer, index, parent }) => [layer, index, parent])).toEqual([
      ['M', 0, 1],
      ['L', 1, -1],
    ]);
    expect([...structure.ownerOfRank]).toEqual([-1, 1, 1, 0, 0, 0, 1, -1]);
    expect([...structure.invisible]).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(structure.layers[0]?.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 30 });
  });

  it('keeps a structure while its tables and fallbacks stand, and reads bounds each plan', () => {
    const input = layeredInput();
    const first = structureOf(input, undefined);
    const layerBounds = new Map([[id('L'), { minX: 1, minY: 2, maxX: 3, maxY: 4 }]]);
    const again = structureOf({ ...input, layerBounds }, first);
    expect(again).toBe(first);
    expect(again.layers[1]?.bounds).toEqual({ minX: 1, minY: 2, maxX: 3, maxY: 4 });
    // This frame's measure leaves M out: it draws nothing.
    expect(again.layers[0]?.bounds).toBeUndefined();
    const { memberBoundsOf: unused, ...withoutBoxes } = input;
    expect(unused).toBeDefined();
    expect(structureOf(withoutBoxes, first).layers[0]?.bounds).toBe(EVERYWHERE);
  });

  it('makes a new structure on a change of fallbacks, keeping what rests on the tables', () => {
    const input = layeredInput();
    const first = structureOf(input, undefined);
    const excluded = structureOf({ ...input, excludedLayers: new Set([id('M')]) }, first);
    expect(excluded).not.toBe(first);
    expect(excluded.layers.map((layer) => layer.id)).toEqual(['L']);
    expect([...excluded.ownerOfRank]).toEqual([-1, 0, 0, 0, 0, 0, 0, -1]);
    expect(excluded.invisible).toBe(first.invisible);
    expect(excluded.all).toBe(first.all);
    expect(isSameTables(first.from, excluded.from)).toBe(true);
    // The same set's contents compare equal; a revision decides alone when given.
    expect(structureOf({ ...input, excludedLayers: new Set([id('M')]) }, excluded)).toBe(excluded);
    const counted = structureOf({ ...input, excludedRevision: 1 }, excluded);
    expect(counted).not.toBe(excluded);
    expect(structureOf({ ...input, excludedRevision: 1 }, counted)).toBe(counted);
    expect(structureOf({ ...input, excludedRevision: 2 }, counted)).not.toBe(counted);
    // New tables, new everything.
    const reordered = structureOf({ ...input, rankById: new Map(input.rankById) }, first);
    expect(reordered.all).not.toBe(first.all);
    expect(isSameTables(first.from, reordered.from)).toBe(false);
  });

  it('lists a window’s visible children’s composites by slot', () => {
    const structure = structureOf(layeredInput(), undefined);
    expect(compositesOf(structure.layers, 'composite')).toEqual({
      entries: [],
      slots: [],
      bounds: [],
    });
    for (const layer of structure.layers) layer.isVisible = true;
    const [inner] = structure.layers;
    if (inner) inner.bounds = undefined;
    expect(compositesOf(structure.layers, 'composite')).toEqual({
      entries: [
        {
          passName: 'composite',
          ranges: [
            { start: 0, count: 1 },
            { start: 1, count: 1 },
          ],
        },
      ],
      slots: [0, 1],
      bounds: [{ minX: 0, minY: 0, maxX: 10, maxY: 30 }, EVERYWHERE],
    });
  });
});
