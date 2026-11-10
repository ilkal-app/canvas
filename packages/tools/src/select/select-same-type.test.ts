import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { sameTypeBoardObjects } from './__fixtures__/same-type-board.js';
import { id } from './__fixtures__/select-board.js';
import { createSelectStore } from './__fixtures__/select-store.js';
import { selectSameTypeOf, type SameTypeSource } from './select-same-type.js';
import { EMPTY_SELECTION, selectionOf, type SelectionState } from './selection-state.js';

function boardSource(): SameTypeSource {
  const store = createSelectStore(sameTypeBoardObjects());
  return {
    get: (objectId) => store.get(objectId),
    childrenOf: (parentId) => store.references.childrenOf(parentId),
  };
}

function extend(ids: string[], scope: string | null = null): SelectionState {
  return selectSameTypeOf(
    selectionOf(ids.map(id)),
    boardSource(),
    scope === null ? null : id(scope),
  );
}

function sorted(ids: readonly ObjectId[]): string[] {
  return [...ids].sort();
}

describe('selectSameTypeOf', () => {
  it('extends a sticky note to every unlocked sticky at the root and in frames', () => {
    const next = extend(['sticky-a']);
    expect(next.ids[0]).toBe('sticky-a');
    expect(next.primaryId).toBe('sticky-a');
    // Not sticky-locked (locked), nor sticky-g and sticky-h (in a group); sticky-e is an unlocked
    // child of a locked frame, which does not hide its children.
    expect(sorted(next.ids)).toEqual(['sticky-a', 'sticky-b', 'sticky-c', 'sticky-d', 'sticky-e']);
  });

  it('matches shapes on their kind as well as their type', () => {
    expect(sorted(extend(['ellipse-a']).ids)).toEqual(['ellipse-a', 'ellipse-b']);
    expect(sorted(extend(['rect-n']).ids)).toEqual(['rect-a', 'rect-n']);
  });

  it('takes every type of a mixed selection', () => {
    expect(sorted(extend(['ellipse-b', 'sticky-c']).ids)).toEqual([
      'ellipse-a',
      'ellipse-b',
      'sticky-a',
      'sticky-b',
      'sticky-c',
      'sticky-d',
      'sticky-e',
    ]);
  });

  it('takes nested frames but leaves locked ones out', () => {
    expect(sorted(extend(['frame-f']).ids)).toEqual(['frame-f', 'frame-n']);
  });

  it('keeps a selected locked object and adds the unlocked ones of its type', () => {
    const next = extend(['sticky-locked']);
    expect(next.primaryId).toBe('sticky-locked');
    expect(sorted(next.ids)).toEqual([
      'sticky-a',
      'sticky-b',
      'sticky-c',
      'sticky-d',
      'sticky-e',
      'sticky-locked',
    ]);
  });

  it('never takes a group child from the root scope', () => {
    expect(extend(['rect-a']).ids).not.toContain('rect-g');
  });

  it('takes the entered group’s children when the group is the scope', () => {
    expect(sorted(extend(['sticky-g'], 'group-g').ids)).toEqual(['sticky-g', 'sticky-h']);
  });

  it('returns the same selection when nothing is selected', () => {
    expect(selectSameTypeOf(EMPTY_SELECTION, boardSource(), null)).toBe(EMPTY_SELECTION);
  });

  it('returns the same selection when there is nothing more of its types', () => {
    const selection = selectionOf([id('group-g')]);
    expect(selectSameTypeOf(selection, boardSource(), null)).toBe(selection);
  });

  it('ignores selected ids the document no longer has', () => {
    expect(sorted(extend(['gone', 'ellipse-a']).ids)).toEqual(['ellipse-a', 'ellipse-b', 'gone']);
    const gone = selectionOf([id('gone')]);
    expect(selectSameTypeOf(gone, boardSource(), null)).toBe(gone);
  });

  it('does not change the selection it is given', () => {
    const selection = selectionOf([id('sticky-a')]);
    const before = structuredClone(selection);
    selectSameTypeOf(selection, boardSource(), null);
    expect(selection).toEqual(before);
  });
});
