import { describe, expect, it } from 'vitest';

import type { DrawListEntry } from '../draw-list.js';
import type { CullRangeChange, InstanceRange } from '../scene-culler.js';

import { id, layeredInput } from './__fixtures__/layered-board.js';
import { CANVAS_WINDOW, reownSlots } from './layer-reown.js';
import { structureOf } from './layer-structure.js';
import { LayeredCoverage } from './layered-coverage.js';

/** The culler's changes: one source per pass, advanced revision by revision. */
class FakeChanges {
  private readonly changes = new Map<string, CullRangeChange>();

  constructor(names: readonly string[]) {
    for (const name of names) {
      this.changes.set(name, {
        source: this,
        revision: 0,
        previousRevision: -1,
        added: [],
        removed: [],
      });
    }
  }

  readonly rangeChangeOf = (name: string) => this.changes.get(name);

  advance(name: string, added: InstanceRange[], removed: InstanceRange[] = [], step = 1): void {
    const change = this.changes.get(name);
    if (change === undefined) throw new Error(name);
    const previousRevision = change.revision + step - 1;
    this.changes.set(name, {
      source: this,
      revision: previousRevision + 1,
      previousRevision,
      added,
      removed,
    });
  }

  drop(name: string): void {
    this.changes.delete(name);
  }
}

const NAMES = ['shape', 'composite', 'title'];

/** Each rank's shape slot, or −1. */
const SHAPE_SLOT_OF_RANK = [0, -1, 1, -1, 2, -1, -1, 3];

/**
 * The board's input with some shape slots visible and the changes provider.
 *
 * @param shapes - The visible shape slots.
 * @param changes - The provider.
 * @param excluded - Layers left out.
 * @returns The input.
 */
function inputOf(shapes: InstanceRange[], changes: FakeChanges, excluded: string[] = []) {
  const visible: DrawListEntry[] = [
    { passName: 'shape', ranges: shapes },
    { passName: 'composite', ranges: [{ start: 0, count: 2 }] },
    { passName: 'title', page: 0, ranges: [{ start: 0, count: 1 }] },
  ];
  return layeredInput({
    visible,
    rangeChangeOf: changes.rangeChangeOf,
    excludedLayers: new Set(excluded.map(id)),
    slotsOfRank: (rank, passName) => {
      const slot = SHAPE_SLOT_OF_RANK[rank] ?? -1;
      return passName === 'shape' && slot >= 0 ? [slot] : [];
    },
  });
}

/**
 * The same input with other layers left out: the same tables.
 *
 * @param input - The input.
 * @param excluded - The layers left out.
 * @returns The input.
 */
function without(input: ReturnType<typeof inputOf>, excluded: string[]) {
  return { ...input, excludedLayers: new Set(excluded.map(id)) };
}

const runs = (coverage: ReturnType<LayeredCoverage['update']>) =>
  Object.fromEntries(
    [...coverage.buckets].map(([key, bucket]) => [
      key === CANVAS_WINDOW ? 'canvas' : key,
      Object.fromEntries([...bucket].map(([run, { ranges }]) => [run, ranges])),
    ]),
  );

describe('LayeredCoverage', () => {
  it('sorts afresh first, then routes each next revision’s slots to their windows', () => {
    const changes = new FakeChanges(NAMES);
    const coverage = new LayeredCoverage();
    const input = inputOf([{ start: 0, count: 2 }], changes);
    const structure = structureOf(input, undefined);
    const first = coverage.update(input, structure);
    expect(first.touched).toBeUndefined();
    expect(runs(first)).toEqual({
      canvas: { shape: [{ start: 0, count: 1 }], 'title 0': [{ start: 0, count: 1 }] },
      L: { shape: [{ start: 1, count: 1 }] },
    });
    // Nothing new: routed, nothing touched.
    const same = coverage.update(input, structure);
    expect(same.touched).toEqual(new Set());
    // d enters (M's), a leaves (the canvas's), z (opacity 0) enters and goes nowhere.
    changes.advance('shape', [{ start: 2, count: 2 }], [{ start: 0, count: 1 }]);
    const routed = coverage.update(input, structure);
    expect(routed.touched).toEqual(new Set(['M', CANVAS_WINDOW]));
    expect(runs(routed)).toEqual({
      canvas: { 'title 0': [{ start: 0, count: 1 }] },
      L: { shape: [{ start: 1, count: 1 }] },
      M: { shape: [{ start: 2, count: 1 }] },
    });
    expect(coverage.canvasChangeOf('shape')).toMatchObject({
      source: coverage,
      added: [],
      removed: [{ start: 0, count: 1 }],
    });
    expect(coverage.canvasChangeOf('shape')).toBe(coverage.canvasChangeOf('shape'));
    coverage.noteCanvasChange('composite', [0], [1]);
    expect(coverage.canvasChangeOf('composite')).toMatchObject({
      added: [{ start: 0, count: 1 }],
      removed: [{ start: 1, count: 1 }],
    });
    // The title is drawn outside layers: its new page's slots stay on the canvas.
    changes.advance('title', [], [{ start: 0, count: 1 }]);
    expect(runs(coverage.update(input, structure)).canvas).toBeUndefined();
  });

  it('sorts afresh when a revision is skipped, a provider is missing, or it is cleared', () => {
    const changes = new FakeChanges(NAMES);
    const coverage = new LayeredCoverage();
    const input = inputOf([{ start: 0, count: 2 }], changes);
    const structure = structureOf(input, undefined);
    coverage.update(input, structure);
    changes.advance('shape', [], [], 2);
    expect(coverage.update(input, structure).touched).toBeUndefined();
    coverage.clear();
    expect(coverage.update(input, structure).touched).toBeUndefined();
    changes.drop('title');
    expect(coverage.update(input, structure).touched).toBeUndefined();
    const other = new LayeredCoverage();
    other.update(input, structure);
    changes.advance('shape', []);
    // Another source's change cannot be routed.
    const elsewhere = new FakeChanges(NAMES);
    expect(
      other.update({ ...input, rangeChangeOf: elsewhere.rangeChangeOf }, structure).touched,
    ).toBeUndefined();
    // Without slots by rank, a change of fallbacks sorts afresh too.
    const plain = new LayeredCoverage();
    const { slotsOfRank: unused, ...withoutSlots } = {
      ...input,
      rangeChangeOf: elsewhere.rangeChangeOf,
    };
    expect(unused).toBeDefined();
    plain.update(withoutSlots, structure);
    const fewer = structureOf(without(input, ['M']), structure);
    expect(plain.update(withoutSlots, fewer).touched).toBeUndefined();
  });

  it('moves the visible slots of the ranks that change window with the fallbacks', () => {
    const changes = new FakeChanges(NAMES);
    const coverage = new LayeredCoverage();
    const all = inputOf([{ start: 0, count: 4 }], changes);
    const both = structureOf(all, undefined);
    coverage.update(all, both);
    // M stops being planned: d goes to L.
    const withoutM = without(all, ['M']);
    const lOnly = structureOf(withoutM, both);
    const moved = coverage.update(withoutM, lOnly);
    expect(moved.touched).toEqual(new Set(['M', 'L']));
    expect(runs(moved).L).toEqual({ shape: [{ start: 1, count: 2 }] });
    expect(runs(moved).M).toBeUndefined();
    // L stops too: c and d go to the canvas, which changes with them.
    const neither = without(all, ['M', 'L']);
    const none = structureOf(neither, lOnly);
    expect(runs(coverage.update(neither, none)).canvas?.shape).toEqual([{ start: 0, count: 3 }]);
    expect(coverage.canvasChangeOf('shape')?.added).toEqual([{ start: 1, count: 2 }]);
    // Both are planned again: each takes its slots back from the canvas.
    const again = structureOf(all, none);
    const back = coverage.update(all, again);
    expect(back.touched).toEqual(new Set([CANVAS_WINDOW, 'L', 'M']));
    expect(runs(back)).toEqual({
      canvas: { shape: [{ start: 0, count: 1 }], 'title 0': [{ start: 0, count: 1 }] },
      L: { shape: [{ start: 1, count: 1 }] },
      M: { shape: [{ start: 2, count: 1 }] },
    });
    expect(coverage.canvasChangeOf('shape')?.removed).toEqual([{ start: 1, count: 2 }]);
  });

  it('reown skips slots another rank owns, slots not visible and passes outside layers', () => {
    const changes = new FakeChanges(NAMES);
    const input = inputOf([{ start: 0, count: 1 }], changes, ['M', 'L']);
    const none = structureOf(input, undefined);
    const both = structureOf({ ...input, excludedLayers: new Set() }, none);
    const moves: string[] = [];
    const canvas = new Map([
      [
        CANVAS_WINDOW,
        new Map([
          ['shape', { passName: 'shape', page: undefined, ranges: [{ start: 0, count: 2 }] }],
          ['title 0', { passName: 'title', page: 0, ranges: [{ start: 0, count: 1 }] }],
        ]),
      ],
    ]);
    reownSlots(
      { ...input, slotsOfRank: (rank) => (rank === 2 ? [1, 0] : [3]) },
      none,
      both,
      canvas,
      (from, to, pass, slot) => moves.push(`${from}>${to}:${pass.name}:${String(slot)}`),
    );
    expect(moves).toEqual([`${CANVAS_WINDOW}>L:shape:1`]);
  });
});
