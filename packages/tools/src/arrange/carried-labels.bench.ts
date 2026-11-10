import { bench, describe } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { benchSize } from '../select/__fixtures__/bench-size.js';
import { sticky } from '../select/__fixtures__/same-type-board.js';
import { id, rect } from '../select/__fixtures__/select-board.js';
import { createSelectStore } from '../select/__fixtures__/select-store.js';
import { tenPointText } from '../text/__fixtures__/text-mode-context.js';

import { carriedLabelsOf } from './carried-labels.js';

// CPU cost of "raise carries labels" on the 50k-object budget board: bringing notes to
// the front or forward expands the selection through `carriedLabelsOf` before the order command
// runs. 50,000 siblings at the root, 27% sticky notes and 10% text (the bench board's mix), on a
// grid where each text straddles two cells; 1,000 of the notes selected, and all 13,500 (a
// select-all of notes). Gated by `pnpm bench:ci` (its micro-benchmark suite.md,
// "Benchmark regression policy").

const COUNT = benchSize({ full: 50_000, smoke: 2_000 });
const COLUMNS = 250;
const CELL = 120;

/**
 * The board: every hundred siblings 27 notes, then 10 texts, then 63 rectangles, stacked in
 * index order (the ids sort as the indexes do and every key is equal).
 *
 * @returns The objects.
 */
function board(): BoardObject[] {
  return [...Array(COUNT).keys()].map((index) => {
    const objectId = `o${String(index).padStart(6, '0')}`;
    const at = { x: (index % COLUMNS) * CELL, y: Math.floor(index / COLUMNS) * CELL };
    const slot = index % 100;
    if (slot < 27) return sticky(objectId, null, at);
    if (slot < 37) {
      // Half a cell to the left: over the object before it and the object at its own cell.
      return tenPointText(objectId, 'label', { x: at.x - CELL / 2, y: at.y + 20, z: 'a0' });
    }
    return rect(objectId, null, { ...at, width: 100, height: 100 });
  });
}

const OBJECTS = board();
const STORE = createSelectStore(OBJECTS);
const NOTE_IDS: ObjectId[] = OBJECTS.filter((object) => object.type === 'sticky').map((object) =>
  id(object.id),
);
const SOME_NOTES = NOTE_IDS.slice(0, Math.round(NOTE_IDS.length * (1_000 / 13_500)));

describe(`carried labels, ${String(COUNT)} siblings`, () => {
  bench(`bring to front, ${String(SOME_NOTES.length)} notes selected`, () => {
    carriedLabelsOf(STORE, SOME_NOTES, 'front');
  });

  bench(`bring to front, ${String(NOTE_IDS.length)} notes selected`, () => {
    carriedLabelsOf(STORE, NOTE_IDS, 'front');
  });

  bench(`bring forward, ${String(NOTE_IDS.length)} notes selected`, () => {
    carriedLabelsOf(STORE, NOTE_IDS, 'forward');
  });
});
