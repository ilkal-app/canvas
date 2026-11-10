import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { frameObject, shapeObject, sourceOf } from '../scene/__fixtures__/scene-objects.js';
import { paintOrderOf } from '../scene/segments/paint-order.js';

import { sortTopmostFirst } from './paint-order.js';

const ids = (...names: string[]) => names.map((name) => name as ObjectId);

describe('sortTopmostFirst', () => {
  it('orders siblings as the z-order segments stage paints them: by z key, then by id', () => {
    const source = sourceOf([
      shapeObject('b', { z: 'a0' }),
      shapeObject('a', { z: 'a0' }),
      shapeObject('upper', { z: 'a1' }),
      shapeObject('capital', { z: 'Z0' }),
    ]);
    expect(sortTopmostFirst(ids('a', 'b', 'upper', 'capital'), source)).toEqual(
      ids('upper', 'b', 'a', 'capital'),
    );
  });

  it('stacks each subtree as a unit: a low frame keeps its children below a higher sibling', () => {
    const source = sourceOf([
      frameObject('low-frame', { z: 'a0' }),
      shapeObject('child', { parentId: 'low-frame', z: 'z9' }),
      shapeObject('high', { z: 'a5' }),
    ]);
    expect(sortTopmostFirst(ids('child', 'high', 'low-frame'), source)).toEqual(
      ids('high', 'child', 'low-frame'),
    );
  });

  it('agrees with the paint order the z-order segments stage draws in, reversed', () => {
    const board = [
      frameObject('f1', { z: 'a1' }),
      shapeObject('f1-top', { parentId: 'f1', z: 'a9' }),
      shapeObject('f1-low', { parentId: 'f1', z: 'a0' }),
      frameObject('f0', { z: 'a0' }),
      shapeObject('f0-child', { parentId: 'f0', z: 'z' }),
      shapeObject('root-tie-b', { z: 'a1' }),
      shapeObject('root-tie-a', { z: 'a1' }),
    ];
    const source = sourceOf(board);
    const allIds = board.map(({ id }) => id);
    expect(sortTopmostFirst(allIds, source)).toEqual(paintOrderOf(board).reverse());
  });

  it('drops ids the document lacks and places an orphan as a root object', () => {
    const source = sourceOf([
      shapeObject('orphan', { parentId: 'missing', z: 'a2' }),
      shapeObject('root', { z: 'a1' }),
    ]);
    expect(sortTopmostFirst(ids('root', 'gone', 'orphan'), source)).toEqual(ids('orphan', 'root'));
  });

  it('cuts a parent cycle instead of looping', () => {
    const source = sourceOf([
      frameObject('p', { parentId: 'q', z: 'a0' }),
      frameObject('q', { parentId: 'p', z: 'a1' }),
    ]);
    expect(sortTopmostFirst(ids('p', 'q'), source)).toHaveLength(2);
  });

  it('does not reorder its input', () => {
    const input = ids('a', 'b');
    const source = sourceOf([shapeObject('a', { z: 'a0' }), shapeObject('b', { z: 'a1' })]);
    expect(sortTopmostFirst(input, source)).toEqual(ids('b', 'a'));
    expect(input).toEqual(ids('a', 'b'));
  });
});
