import { bench, describe } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { benchSize } from './__fixtures__/bench-size.js';
import { sticky } from './__fixtures__/same-type-board.js';
import { frame, id, rect } from './__fixtures__/select-board.js';
import { createSelectStore } from './__fixtures__/select-store.js';
import { selectSameTypeOf, type SameTypeSource } from './select-same-type.js';
import { selectionOf } from './selection-state.js';

// CPU cost of select same type on the 50k-object budget board: one shortcut press walks
// the scope's children and its frames' once, reading each object from the document, so it is
// linear in the board. 50,000 objects, one in five a sticky note, half of them in 100 frames.
// Gated by `pnpm bench:ci` (its micro-benchmark suite).

const COUNT = benchSize({ full: 50_000, smoke: 2_000 });
const FRAMES = 100;

/**
 * The board: `FRAMES` frames, then `COUNT - FRAMES` objects, every fifth a sticky note and the
 * rest rectangles, alternately at the root and in the frames.
 *
 * @returns The objects, parents before children.
 */
function board(): BoardObject[] {
  const frames = [...Array(FRAMES).keys()].map((index) =>
    frame(`f${String(index)}`, null, { x: index * 1000, y: -2000, width: 900, height: 900 }),
  );
  const objects = [...Array(COUNT - FRAMES).keys()].map((index) => {
    const parentId = index % 2 === 0 ? null : `f${String(index % FRAMES)}`;
    const at = { x: (index % 200) * 120, y: Math.floor(index / 200) * 120 };
    const objectId = `o${String(index)}`;
    return index % 5 === 0
      ? sticky(objectId, parentId, at)
      : rect(objectId, parentId, { ...at, width: 100, height: 100 });
  });
  return [...frames, ...objects];
}

const STORE = createSelectStore(board());
const SOURCE: SameTypeSource = {
  get: (objectId) => STORE.get(objectId),
  childrenOf: (parentId) => STORE.references.childrenOf(parentId),
};
const ONE_STICKY = selectionOf([id('o0')]);

describe(`select same type, ${String(COUNT)} objects`, () => {
  bench('one sticky note extended to every sticky note', () => {
    selectSameTypeOf(ONE_STICKY, SOURCE, null);
  });
});
