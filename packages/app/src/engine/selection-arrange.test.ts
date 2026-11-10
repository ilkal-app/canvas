import { describe, expect, it } from 'vitest';

import {
  createHistory,
  sortedSiblings,
  SYSTEM_ORIGIN,
  YjsDocumentStore,
  type ChangeSet,
} from '@canvas/document';
import type {
  ObjectId,
  PrincipalId,
  ShapeObject,
  StickyObject,
  TextObject,
  TextStyle,
} from '@canvas/schema';

import { LOCAL_USER_ORIGIN } from './demo-document.js';
import { reorderSelection, toggleSelectionLock } from './selection-arrange.js';

/**
 * The fields every object has.
 *
 * @param id - Its id.
 * @param parentId - Its parent, or `null` for the root.
 * @param z - Its z key.
 * @param isLocked - Whether it is locked.
 * @returns The fields.
 */
function placement(id: string, parentId: string | null, z: string, isLocked = false) {
  return {
    id: id as ObjectId,
    parentId: parentId as ObjectId | null,
    x: 0,
    y: 0,
    rotation: 0,
    z,
    locked: isLocked,
    createdBy: 'user:demo' as PrincipalId,
    createdAt: 1_790_000_000_000,
    updatedAt: 1_790_000_000_000,
  };
}

/**
 * A 50 × 50 rectangle.
 *
 * @param id - Its id.
 * @param parentId - Its parent, or `null` for the root.
 * @param z - Its z key.
 * @param isLocked - Whether it is locked.
 * @returns The rectangle.
 */
function rect(id: string, parentId: string | null, z: string, isLocked = false): ShapeObject {
  return {
    ...placement(id, parentId, z, isLocked),
    type: 'shape',
    kind: 'rectangle',
    width: 50,
    height: 50,
    stroke: null,
    fill: [1, 0, 0, 1],
    cornerRadius: 0,
    sides: 4,
    label: null,
  };
}

/**
 * A board of three root rectangles bottom to top a, b, c (c locked), and a group holding d.
 *
 * @returns The target to run edits against, with its store's change sets and the user's history.
 */
function setUp() {
  const store = new YjsDocumentStore();
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    transaction.setObject(rect('a', null, 'a0'));
    transaction.setObject(rect('b', null, 'a1'));
    transaction.setObject(rect('c', null, 'a2', true));
    transaction.setObject({ ...placement('g', null, 'a3'), type: 'group' });
    transaction.setObject(rect('d', 'g', 'a0'));
  });
  const changeSets: ChangeSet[] = [];
  store.subscribe((changes) => changeSets.push(changes));
  const history = createHistory(store, LOCAL_USER_ORIGIN.principalId);
  const target = {
    store,
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
  };
  return { store, target, changeSets, history };
}

const ids = (...values: string[]) => values as ObjectId[];

describe('reorderSelection', () => {
  it('runs each order command on the selection as one command', () => {
    const { store, target, changeSets } = setUp();
    reorderSelection(target, 'bringToFront', ids('a'));
    expect(sortedSiblings(store, null)).toEqual(['b', 'c', 'g', 'a']);
    reorderSelection(target, 'sendToBack', ids('a'));
    expect(sortedSiblings(store, null)).toEqual(['a', 'b', 'c', 'g']);
    reorderSelection(target, 'bringForward', ids('a'));
    expect(sortedSiblings(store, null)).toEqual(['b', 'a', 'c', 'g']);
    reorderSelection(target, 'sendBackward', ids('a'));
    expect(sortedSiblings(store, null)).toEqual(['a', 'b', 'c', 'g']);
    expect(changeSets.map(({ updated }) => updated)).toEqual([['a'], ['a'], ['a'], ['a']]);
  });

  it('reorders locked objects too: a lock stops moves, not stacking', () => {
    const { store, target } = setUp();
    reorderSelection(target, 'sendToBack', ids('c'));
    expect(sortedSiblings(store, null)).toEqual(['c', 'a', 'b', 'g']);
  });

  it('reorders the largest same-parent subset and reports the rest as left out', () => {
    const { store, target } = setUp();
    expect(reorderSelection(target, 'bringToFront', ids('d', 'a', 'b'))).toEqual({
      ids: ['a', 'b'],
      leftOutIds: ['d'],
    });
    expect(sortedSiblings(store, null)).toEqual(['c', 'g', 'a', 'b']);
  });

  it('runs nothing with nothing selected', () => {
    const { target, changeSets } = setUp();
    expect(reorderSelection(target, 'bringToFront', [])).toEqual({ ids: [], leftOutIds: [] });
    expect(changeSets).toEqual([]);
  });
});

const STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 24,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

/**
 * A text label at (20, 20), 100 × 30.
 *
 * @param id - Its id.
 * @param z - Its z key.
 * @returns The text.
 */
function label(id: string, z: string): TextObject {
  return {
    ...placement(id, null, z),
    x: 20,
    y: 20,
    type: 'text',
    width: 100,
    height: 30,
    text: 'label',
    runs: [{ length: 5, style: STYLE }],
    align: 'left',
    autoWidth: true,
    verticalAlign: 'top',
  };
}

/**
 * A 200 × 200 yellow note at the origin.
 *
 * @param id - Its id.
 * @param z - Its z key.
 * @returns The note.
 */
function note(id: string, z: string): StickyObject {
  return {
    ...label(id, z),
    x: 0,
    y: 0,
    type: 'sticky',
    width: 200,
    height: 200,
    text: '',
    runs: [{ length: 0, style: STYLE }],
    align: 'center',
    autoWidth: false,
    verticalAlign: 'middle',
    color: [1, 0.92, 0.55, 1],
  };
}

describe('reorderSelection with sticky notes', () => {
  function noteBoard(...objects: (ShapeObject | TextObject | StickyObject)[]) {
    const { store, target, changeSets } = setUp();
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      for (const id of ['a', 'b', 'c', 'd', 'g']) transaction.deleteObject(id as ObjectId);
      for (const object of objects) transaction.setObject(object);
    });
    changeSets.length = 0;
    return { store, target, changeSets };
  }

  it('brings a note to the front with the label on it, in one command', () => {
    const { store, target, changeSets } = noteBoard(
      note('n', 'a0'),
      label('t', 'a1'),
      rect('r', null, 'a2'),
    );
    reorderSelection(target, 'bringToFront', ids('n'));
    expect(sortedSiblings(store, null)).toEqual(['r', 'n', 't']);
    expect(changeSets.map(({ updated }) => [...updated].sort())).toEqual([['n', 't']]);
  });

  it('brings a note forward with the label on it, keeping the label above', () => {
    const { store, target } = noteBoard(note('n', 'a0'), label('t', 'a1'), rect('r', null, 'a2'));
    reorderSelection(target, 'bringForward', ids('n'));
    expect(sortedSiblings(store, null)).toEqual(['r', 'n', 't']);
  });

  it('brings a note forward past another object without lifting the label that stays above it', () => {
    // Note, other, label, other: the note hops the first other and is still under the label.
    const { store, target } = noteBoard(
      note('n', 'a0'),
      rect('x', null, 'a1'),
      label('t', 'a2'),
      rect('m', null, 'a3'),
    );
    reorderSelection(target, 'bringForward', ids('n'));
    expect(sortedSiblings(store, null)).toEqual(['x', 'n', 't', 'm']);
  });

  it('sends a note back alone: what is on it stays above it', () => {
    const { store, target } = noteBoard(rect('r', null, 'a0'), note('n', 'a1'), label('t', 'a2'));
    reorderSelection(target, 'sendBackward', ids('n'));
    expect(sortedSiblings(store, null)).toEqual(['n', 'r', 't']);
  });
});

describe('toggleSelectionLock', () => {
  it('locks a mixed selection in one command, one undo step, and unlocks it again', () => {
    const { store, target, changeSets, history } = setUp();
    expect(toggleSelectionLock(target, ids('a', 'c'))).toBe(true);
    expect(store.get('a' as ObjectId)?.locked).toBe(true);
    expect(store.get('c' as ObjectId)?.locked).toBe(true);
    expect(changeSets.map(({ updated }) => updated)).toEqual([['a']]);
    history.undo();
    expect(store.get('a' as ObjectId)?.locked).toBe(false);
    expect(store.get('c' as ObjectId)?.locked).toBe(true);
    toggleSelectionLock(target, ids('a', 'c'));
    toggleSelectionLock(target, ids('a', 'c'));
    expect(store.get('a' as ObjectId)?.locked).toBe(false);
    expect(store.get('c' as ObjectId)?.locked).toBe(false);
  });

  it('runs nothing when nothing selected exists', () => {
    const { target, changeSets } = setUp();
    expect(toggleSelectionLock(target, ids('gone'))).toBe(false);
    expect(toggleSelectionLock(target, [])).toBe(false);
    expect(changeSets).toEqual([]);
  });
});
