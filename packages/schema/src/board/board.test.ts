import { describe, expect, it } from 'vitest';

import type { PageId } from '../ids/page-id.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';

import { createBoard } from './board.js';
import { buildChildIndex } from './child-index.js';

describe('createBoard', () => {
  it('keys every object by its id', () => {
    const board = createBoard([sampleObject('frame', 'f1'), sampleObject('shape', 's1')]);
    expect([...board.objects.keys()]).toEqual(['f1', 's1']);
    expect(board.objects.get(sampleObject('shape', 's1').id)?.type).toBe('shape');
  });

  it('throws on a duplicate id rather than silently keeping one of them', () => {
    expect(() => createBoard([sampleObject('shape', 'dup'), sampleObject('frame', 'dup')])).toThrow(
      new RangeError('Duplicate object id "dup"'),
    );
  });

  it('keys pages by id and throws on a duplicate page id', () => {
    const page = (id: string) => ({ id: id as PageId, name: id, order: 'a0' });
    expect([...(createBoard([], [page('p1'), page('p2')]).pages?.keys() ?? [])]).toEqual([
      'p1',
      'p2',
    ]);
    expect(() => createBoard([], [page('p1'), page('p1')])).toThrow(
      new RangeError('Duplicate page id "p1"'),
    );
  });
});

describe('buildChildIndex', () => {
  it('lists the children of each parent under its id and the root children under null', () => {
    const frame = sampleObject('frame', 'f');
    const board = createBoard([
      frame,
      sampleObject('shape', 'b', { parentId: frame.id, z: 'a1' }),
      sampleObject('shape', 'a', { parentId: frame.id, z: 'a1' }),
      sampleObject('shape', 'c', { parentId: frame.id, z: 'a0' }),
      sampleObject('shape', 'root-shape', { z: 'a2' }),
    ]);
    const children = buildChildIndex(board);
    expect([...(children.get(frame.id) ?? [])].sort()).toEqual(['a', 'b', 'c']);
    expect([...(children.get(null) ?? [])].sort()).toEqual(['f', 'root-shape']);
  });

  it('lists an object whose parent is missing under the missing id', () => {
    const orphan = sampleObject('shape', 'orphan', { parentId: sampleObject('group', 'gone').id });
    expect(buildChildIndex(createBoard([orphan])).get(sampleObject('group', 'gone').id)).toEqual([
      'orphan',
    ]);
  });
});
