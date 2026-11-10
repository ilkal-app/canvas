// definitionClosure's edges: what it leaves out and how it places ancestors.
import { describe, expect, it } from 'vitest';

import { createBoard, type BoardObject } from '@canvas/schema';

import { definitionClosure } from './instance-projection.js';

/**
 * A minimal object for the walk, which reads only ids, types, parents, mains and records.
 *
 * @param id - Its id.
 * @param type - Its type.
 * @param parentId - Its parent.
 * @param fields - Further fields.
 * @returns The object.
 */
function object(
  id: string,
  type: BoardObject['type'],
  parentId: string | null,
  fields: Readonly<Record<string, unknown>> = {},
): BoardObject {
  return { id, type, parentId, ...fields } as unknown as BoardObject;
}

describe('definitionClosure', () => {
  it('leaves comments out, places each ancestor once and stops at a missing parent', () => {
    const board = createBoard([
      object('outer', 'component', 'lost'),
      object('note', 'comment', 'outer'),
      object('empty', 'frame', 'outer'),
      object('inner', 'component', 'outer'),
      object('dot', 'shape', 'inner'),
      object('icon', 'component', null),
    ]);
    const placed = object('placed', 'instance', null, {
      mainId: 'inner',
      overrides: { dot: { mainId: 'icon' } },
    });
    const second = object('second', 'instance', null, { mainId: 'outer', overrides: {} });
    const ids = definitionClosure(board, [placed, second]).map(({ id }) => id);
    expect(ids).toEqual(['outer', 'inner', 'icon', 'dot', 'empty']);
  });
});
