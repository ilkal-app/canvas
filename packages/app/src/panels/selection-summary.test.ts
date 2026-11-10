import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { memoryShape } from './__fixtures__/memory-board.js';
import { selectionSummary } from './selection-summary.js';

/**
 * An object of a type, as the header reads it.
 *
 * @param type - Its type.
 * @param fields - Fields over the fixture's shape.
 * @returns The object.
 */
function object(type: BoardObject['type'], fields: Record<string, unknown> = {}): BoardObject {
  return { ...memoryShape(`${type}-1`, 'a0'), type, ...fields } as BoardObject;
}

describe('selectionSummary', () => {
  it('names one object by its type, or a shape by its kind, over "1 object"', () => {
    expect(selectionSummary([object('sticky')], 'select', false)).toEqual({
      title: 'Sticky note',
      detail: '1 object',
    });
    expect(selectionSummary([object('path')], 'select', false)).toEqual({
      title: 'Pen path',
      detail: '1 object',
    });
    expect(selectionSummary([object('shape', { kind: 'star' })], 'select', false)).toEqual({
      title: 'Star',
      detail: '1 object',
    });
  });

  it('captions a frame by its name, a group by its count, a locked object "Locked"', () => {
    expect(selectionSummary([object('frame', { name: 'Story map' })], 'select', false)).toEqual({
      title: 'Frame',
      detail: 'Story map',
    });
    expect(selectionSummary([object('component', { name: 'Card' })], 'select', false)).toEqual({
      title: 'Component',
      detail: 'Card',
    });
    const board = {
      references: { childrenOf: (id: ObjectId) => new Set(id === 'group-1' ? ['a', 'b'] : []) },
    };
    expect(selectionSummary([object('group')], 'select', false, board)).toEqual({
      title: 'Group',
      detail: '2 objects',
    });
    expect(selectionSummary([object('sticky', { locked: true })], 'select', false)).toEqual({
      title: 'Sticky note',
      detail: 'Locked',
    });
  });

  it('counts several of one type by type, "Same kind" (the design’s mixed-selection frame)', () => {
    expect(selectionSummary(Array(3).fill(object('sticky')), 'select', false)).toEqual({
      title: '3 sticky notes',
      detail: 'Same kind',
    });
  });

  it('counts a mixed selection and lists its kinds', () => {
    const selection = [object('sticky'), object('shape'), object('connector'), object('shape')];
    expect(selectionSummary(selection, 'select', false)).toEqual({
      title: '4 objects',
      detail: 'Note, shape, connector',
    });
  });

  it('names the creation tool whose style the next object takes, else "Nothing selected"', () => {
    expect(selectionSummary([], 'sticky', true)).toEqual({
      title: 'Note tool',
      detail: 'Style of the next note',
    });
    expect(selectionSummary([], 'select', false)).toEqual({
      title: 'Style',
      detail: 'Nothing selected',
    });
  });
});
