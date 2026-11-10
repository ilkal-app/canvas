import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { CullRangeChange } from '../scene-culler.js';
import type { Scene } from '../scene.js';

import type { SegmentSpatialIndex } from './segment-moves.js';
import { SegmentTouches, withHidden, withTouched } from './segment-touches.js';
import { windowVisible } from './segment-window.js';

// A scene of one paged pass and one plain one, whose tables the test changes.
function sceneWith(pages: Int32Array) {
  const state = { pages, revision: 0, slots: new Map<string, number[]>() };
  const scene = {
    passes: [{ name: 'text' }, { name: 'shape' }],
    pagesOf: (name: string) => (name === 'text' ? state.pages : undefined),
    pageRevisionOf: (name: string) => (name === 'text' ? state.revision : 0),
    slotsOf: (id: ObjectId, name: string) => state.slots.get(`${id}/${name}`) ?? [],
  } as unknown as Scene;
  return { scene, state };
}

// An index whose drawing changes the test sets.
function spatialWith(changes: { revision: number; ids: readonly ObjectId[] | undefined }) {
  const spatial: SegmentSpatialIndex = {
    get drawingBoundsRevision() {
      return changes.revision;
    },
    drawingChanges: { since: () => changes.ids },
    boundsOf: () => undefined,
    searchRect: () => [],
  };
  return spatial;
}

const DRAWN = [
  { passName: 'text', ranges: [{ start: 0, count: 4 }] },
  { passName: 'shape', ranges: [{ start: 0, count: 2 }] },
];
const NO_SLOTS = (): readonly number[] => [];

describe('SegmentTouches', () => {
  it('lists drawn slots whose page changed, and gives up when the table grew', () => {
    const { scene, state } = sceneWith(Int32Array.of(0, 0, 0, 0, 0));
    const touches = new SegmentTouches(undefined);
    touches.planned(scene, []);
    expect(touches.isDirty(scene)).toBe(false);
    state.pages[1] = 2;
    state.pages[4] = 1;
    state.revision += 1;
    expect(touches.isDirty(scene)).toBe(true);
    expect(touches.collect(scene, DRAWN, [], NO_SLOTS)?.replanned).toEqual(
      new Map([['text', [1]]]),
    );
    touches.planned(scene, []);
    state.pages = new Int32Array(8);
    state.revision += 1;
    expect(touches.collect(scene, DRAWN, [], NO_SLOTS)).toBeUndefined();
  });

  it('lists the slots of objects whose drawing box changed, unless the index cannot say', () => {
    const { scene, state } = sceneWith(new Int32Array(4));
    state.slots.set('a/shape', [1, 9]);
    const changes: { revision: number; ids: readonly ObjectId[] | undefined } = {
      revision: 3,
      ids: ['a' as ObjectId, 'a' as ObjectId],
    };
    const touches = new SegmentTouches(spatialWith(changes));
    touches.planned(scene, []);
    changes.revision = 4;
    expect(touches.collect(scene, DRAWN, [], NO_SLOTS)?.replanned).toEqual(
      new Map([['shape', [1]]]),
    );
    changes.ids = undefined;
    expect(touches.collect(scene, DRAWN, [], NO_SLOTS)).toBeUndefined();
  });

  it('enters the slots of objects shown again, and lets those of objects hidden leave', () => {
    const { scene } = sceneWith(new Int32Array(4));
    const touches = new SegmentTouches(undefined);
    const slotsOf = (rank: number): readonly number[] => [rank, rank + 10];
    touches.planned(scene, [Uint8Array.of(1, 0, 1), undefined]);
    const shown = touches.collect(scene, DRAWN, [Uint8Array.of(0, 0, 1), undefined], slotsOf);
    expect(shown?.shown).toEqual(new Map([['text', [0]]]));
    // A hide patches too, every slot of the hidden rank leaving.
    const hidden = touches.collect(scene, DRAWN, [Uint8Array.of(1, 1, 1), undefined], slotsOf);
    expect(hidden?.hidden).toEqual(new Map([['text', [1, 11]]]));
    expect(hidden?.shown).toEqual(new Map());
    expect(touches.collect(scene, DRAWN, [undefined, undefined], undefined)).toBeUndefined();
  });
});

describe('the touch limit', () => {
  // 4,000 drawn records: a patch takes at most 1,000 touched slots.
  const bigDraw = [{ passName: 'text', ranges: [{ start: 0, count: 4000 }] }];

  it('plans in full once more page changes are drawn than a patch takes', () => {
    const { scene, state } = sceneWith(new Int32Array(4000));
    const touches = new SegmentTouches(undefined);
    touches.planned(scene, []);
    state.pages.fill(1, 0, 1001);
    state.revision += 1;
    expect(touches.collect(scene, bigDraw, [], NO_SLOTS)).toBeUndefined();
    state.pages.fill(0, 1000);
    expect(touches.collect(scene, bigDraw, [], NO_SLOTS)?.replanned.get('text')).toHaveLength(1000);
  });

  it('plans in full once too many drawing boxes or shown texts touch slots', () => {
    const { scene, state } = sceneWith(new Int32Array(4000));
    const many = Array.from({ length: 1001 }, (unused, index) => index);
    state.slots.set('a/text', many);
    const changes = { revision: 0, ids: ['a' as ObjectId] as readonly ObjectId[] | undefined };
    const touches = new SegmentTouches(spatialWith(changes));
    touches.planned(scene, [Uint8Array.of(1), undefined]);
    changes.revision = 1;
    expect(
      touches.collect(scene, bigDraw, [Uint8Array.of(1), undefined], NO_SLOTS),
    ).toBeUndefined();
    changes.revision = 0;
    const shown = touches.collect(scene, bigDraw, [Uint8Array.of(0), undefined], () => many);
    expect(shown).toBeUndefined();
  });
});

describe('withTouched', () => {
  it('adds replanned slots as leaving and entering, and shown ones as entering, to each pass', () => {
    const source = {};
    const pending = new Map<string, CullRangeChange>([
      [
        'text',
        {
          source,
          revision: 2,
          previousRevision: 1,
          added: [{ start: 7, count: 1 }],
          removed: [],
        },
      ],
    ]);
    const merged = withTouched(pending, {
      replanned: new Map([['text', [1]]]),
      shown: new Map([['shape', [3]]]),
    });
    expect(merged.get('text')).toMatchObject({
      source,
      revision: 2,
      added: [
        { start: 7, count: 1 },
        { start: 1, count: 1 },
      ],
      removed: [{ start: 1, count: 1 }],
    });
    expect(merged.get('shape')).toMatchObject({
      added: [{ start: 3, count: 1 }],
      removed: [],
    });
  });
});

describe('a touched slot the culler also changed', () => {
  it('leaves the interval drawing each slot once, whatever repeats', () => {
    const change = (added: number[], removed: number[]): CullRangeChange => ({
      source: {},
      revision: 1,
      previousRevision: 0,
      added: added.map((start) => ({ start, count: 1 })),
      removed: removed.map((start) => ({ start, count: 1 })),
    });
    // Touched slots are drawn now (`collect` keeps those the draw list draws): slot 5 enters with
    // the culler and is touched twice, slot 1 stays and is touched; slot 2 leaves, untouched.
    const merged = withTouched(new Map([['text', change([5], [2])]]), {
      replanned: new Map([['text', [5, 5, 1]]]),
      shown: new Map(),
    });
    const delta = merged.get('text');
    if (delta === undefined) throw new Error('Missing delta');
    const old = { plan: { entries: [{ passName: 'text', ranges: [{ start: 0, count: 4 }] }] } };
    expect(
      windowVisible(
        old,
        new Map([['text', { added: [...delta.added], removed: [...delta.removed] }]]),
      ),
    ).toEqual([
      {
        passName: 'text',
        ranges: [
          { start: 0, count: 2 },
          { start: 3, count: 1 },
          { start: 5, count: 1 },
        ],
      },
    ]);
  });
});

describe('withHidden', () => {
  it('gives each pass its new table, an empty one where nothing is hidden', () => {
    const owners = { rankOfSlot: new Int32Array(), recordOfSlot: new Int32Array() };
    const table = Uint8Array.of(1);
    const passes = withHidden(
      [
        { name: 'text', owners, isHiddenByRank: Uint8Array.of(0) },
        { name: 'shape', owners },
      ],
      [undefined, table],
    );
    expect(passes[0]?.isHiddenByRank).toHaveLength(0);
    expect(passes[1]?.isHiddenByRank).toBe(table);
  });
});
