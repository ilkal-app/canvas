import { bench, describe } from 'vitest';

import type { BoardObject, ObjectId, Point } from '@canvas/schema';

import { group, indexOf, rect } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';
import { isChangeRelated, selectionRelationsOf } from './selection-relations.js';

// CPU cost of a hover (a pointer move with no button down, which only picks the cursor) and of
// the controller's reaction to change sets that do not touch the selection, with 10,000 objects
// selected. Input handling and remote edits share the frame's budget; twenty
// collaborators at 20 Hz are 400 change sets a second. The controller keeps the selection's frame
// between inputs and ignores unrelated change sets, so both are constant time whatever the
// selection's size.
// Gated by `pnpm bench:ci` (its micro-benchmark suite).

/**
 * 10,001 rectangles, 100 × 100 of them on a 50 world-unit grid and one more beyond it.
 *
 * @returns The objects.
 */
function board(): BoardObject[] {
  return [...Array(10_001).keys()].map((index) =>
    rect(`r${String(index)}`, null, {
      x: (index % 100) * 50,
      y: Math.floor(index / 100) * 50,
      width: 40,
      height: 40,
    }),
  );
}

const OBJECTS = board();
const STORE = createSelectStore(OBJECTS);
const CONTROLLER = new SelectController({
  store: STORE,
  origin: ADA,
  environment: ENVIRONMENT,
  hitTester: createSelectHitTester(indexOf(OBJECTS), storeSource(STORE)),
});
const SELECTED = OBJECTS.slice(0, -1).map(({ id }): ObjectId => id);
CONTROLLER.select(SELECTED);
const UNRELATED = OBJECTS.at(-1)?.id ?? SELECTED[0];

/** Four hundred change sets, each touching only the unselected rectangle, as ids. */
const UNRELATED_CHANGES = [...Array(400).keys()].map((index) => ({
  created: [],
  updated: [UNRELATED ?? SELECTED[index] ?? ('r0' as ObjectId)],
  deleted: [],
}));
const RELATIONS = selectionRelationsOf(SELECTED, storeSource(STORE));
const SOURCE = storeSource(STORE);
/** The same board with no controller listening, for the store's own cost. */
const BARE_STORE = createSelectStore(OBJECTS);

/**
 * A hover at a point, at 100%.
 *
 * @param point - The pointer, world units and CSS px alike.
 */
function hover(point: Point): void {
  CONTROLLER.handle(
    {
      kind: 'pointerMove',
      screen: point,
      world: point,
      isShiftPressed: false,
      isModPressed: false,
    },
    1,
  );
}

describe('select controller per hover, 10,000 objects selected', () => {
  bench('a hover in and out of the top-left rotation band', () => {
    hover({ x: -8, y: -8 });
    hover({ x: 2500, y: -30 });
  });
});

/**
 * A pointer input at a point, at 100%.
 *
 * @param controller - The controller.
 * @param kind - The input.
 * @param point - The pointer, world units and CSS px alike.
 */
function pointer(
  controller: SelectController,
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  point: Point,
): void {
  controller.handle(
    { kind, screen: point, world: point, isShiftPressed: false, isModPressed: false },
    1,
  );
}

// A drag of a large selection (N6): the selection's near and far objects are worked out
// once, when the drag starts (`SelectionScope`, kept by the frame cache), not on every pointer
// move; what a move costs is planning the move and previewing the 10,000 objects it changes.
const DRAG_STORE = createSelectStore(OBJECTS);
const DRAGGER = new SelectController({
  store: DRAG_STORE,
  origin: ADA,
  environment: ENVIRONMENT,
  hitTester: createSelectHitTester(indexOf(OBJECTS), storeSource(DRAG_STORE)),
});
DRAGGER.select(SELECTED);
pointer(DRAGGER, 'pointerDown', { x: 20, y: 20 });
pointer(DRAGGER, 'pointerMove', { x: 40, y: 40 });
let dragStep = 0;

describe('select controller per drag move, 10,000 objects selected', () => {
  bench('a pointer move of the drag: plan and preview, the far test kept from its start', () => {
    dragStep += 1;
    pointer(DRAGGER, 'pointerMove', { x: 40 + (dragStep % 2) * 10, y: 40 });
  });
});

describe('select controller per remote change set, 10,000 objects selected', () => {
  bench('400 change sets touching one unselected object: the relevance check alone', () => {
    for (const changes of UNRELATED_CHANGES) isChangeRelated(changes, RELATIONS, SOURCE);
  });

  bench('400 transactions on one object, the store alone (the baseline)', () => {
    for (let index = 0; index < 400; index += 1) {
      BARE_STORE.transact(ADA, (transaction) => {
        transaction.patchObject(UNRELATED ?? ('r0' as ObjectId), { x: 6000 + (index % 2) });
      });
    }
  });

  bench('400 transactions on one unselected object, through the store and the controller', () => {
    for (let index = 0; index < 400; index += 1) {
      STORE.transact(ADA, (transaction) => {
        transaction.patchObject(UNRELATED ?? ('r0' as ObjectId), { x: 6000 + (index % 2) });
      });
    }
  });
});

// A group entered with a double-click: the overlay outlines the entered group's
// derived box, which the controller keeps between inputs, so a hover inside a 1,000-child group
// costs what it costs at the top level, and a change set touching nothing in the group is
// ignored as before.

/**
 * A group of 1,000 rectangles, 50 × 20 on a 50 world-unit grid, and one rectangle outside it.
 *
 * @returns The objects, parents first.
 */
function groupedBoard(): BoardObject[] {
  const children = [...Array(1_000).keys()].map((index) =>
    rect(`g${String(index)}`, 'group-big', {
      x: (index % 50) * 50,
      y: Math.floor(index / 50) * 50,
      width: 40,
      height: 40,
    }),
  );
  const outside = rect('outside', null, { x: 5000, y: 5000, width: 40, height: 40 });
  return [group('group-big', null, 0, 0), ...children, outside];
}

const GROUPED_OBJECTS = groupedBoard();
const GROUPED_STORE = createSelectStore(GROUPED_OBJECTS);
const GROUPED = new SelectController({
  store: GROUPED_STORE,
  origin: ADA,
  environment: ENVIRONMENT,
  hitTester: createSelectHitTester(indexOf(GROUPED_OBJECTS), storeSource(GROUPED_STORE)),
});
GROUPED.enterGroup('group-big' as ObjectId, { x: 10, y: 10 }, 1);

/**
 * A hover over the grouped board, at 100%.
 *
 * @param point - The pointer, world units and CSS px alike.
 */
function hoverGrouped(point: Point): void {
  GROUPED.handle(
    {
      kind: 'pointerMove',
      screen: point,
      world: point,
      isShiftPressed: false,
      isModPressed: false,
    },
    1,
  );
}

describe('select controller per hover, a 1,000-child group entered', () => {
  bench('a hover in and out of the selected child’s rotation band', () => {
    hoverGrouped({ x: -8, y: -8 });
    hoverGrouped({ x: 1200, y: 600 });
  });

  bench(
    '400 transactions on one object outside the group, through the store and the controller',
    () => {
      for (let index = 0; index < 400; index += 1) {
        GROUPED_STORE.transact(ADA, (transaction) => {
          transaction.patchObject('outside' as ObjectId, { x: 5000 + (index % 2) });
        });
      }
    },
  );
});
