import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import {
  EMPTY_SELECTION,
  isSameSelection,
  isSelected,
  selectionOf,
  toggleSelected,
  withoutObjects,
} from './selection-state.js';

const [A, B, C] = ['a', 'b', 'c'] as ObjectId[] as [ObjectId, ObjectId, ObjectId];

describe('SelectionState', () => {
  it('starts empty, with no primary object', () => {
    expect(EMPTY_SELECTION).toEqual({ ids: [], primaryId: undefined });
  });

  it('keeps ids in order without repeats; the first is the primary', () => {
    const selection = selectionOf([B, A, B]);
    expect(selection).toEqual({ ids: [B, A], primaryId: B });
    expect(isSelected(selection, A)).toBe(true);
    expect(isSelected(selection, C)).toBe(false);
  });

  it('toggles an id in, making it the primary, and out again', () => {
    const added = toggleSelected(selectionOf([A]), B);
    expect(added).toEqual({ ids: [A, B], primaryId: B });
    const removed = toggleSelected(added, B);
    expect(removed).toEqual({ ids: [A], primaryId: A });
    expect(toggleSelected(removed, A)).toEqual(EMPTY_SELECTION);
  });

  it('keeps the primary when another id is toggled out', () => {
    const selection = { ids: [A, B, C], primaryId: B };
    expect(toggleSelected(selection, C)).toEqual({ ids: [A, B], primaryId: B });
  });

  it('drops deleted objects, returning the same state when none was selected', () => {
    const selection = selectionOf([A, B]);
    expect(withoutObjects(selection, [A])).toEqual({ ids: [B], primaryId: B });
    expect(withoutObjects(selection, [B])).toEqual({ ids: [A], primaryId: A });
    expect(withoutObjects(selection, [A, B])).toEqual(EMPTY_SELECTION);
    expect(withoutObjects(selection, [C])).toBe(selection);
  });

  it('compares selections by ids and primary', () => {
    expect(isSameSelection(selectionOf([A, B]), selectionOf([A, B]))).toBe(true);
    expect(isSameSelection(selectionOf([A, B]), selectionOf([B, A]))).toBe(false);
    expect(isSameSelection(selectionOf([A, B]), { ids: [A, B], primaryId: B })).toBe(false);
  });

  it('never changes the state it is given', () => {
    const selection = Object.freeze(selectionOf([A]));
    toggleSelected(selection, B);
    withoutObjects(selection, [A]);
    expect(selection).toEqual({ ids: [A], primaryId: A });
  });
});
