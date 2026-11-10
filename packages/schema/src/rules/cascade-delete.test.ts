import { describe, expect, it } from 'vitest';

import { createBoard } from '../board/board.js';
import type { ObjectId } from '../ids/object-id.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';

import { deepFreeze } from './__fixtures__/deep-freeze.js';
import { cascadeDelete } from './cascade-delete.js';
import { validateBoard } from './validate-board.js';

const id = (value: string): ObjectId => value as ObjectId;

function scene(): ReturnType<typeof createBoard> {
  const frame = sampleObject('frame', 'frame');
  const group = sampleObject('group', 'group', { parentId: frame.id });
  return deepFreeze(
    createBoard([
      frame,
      group,
      sampleObject('shape', 'inner', { parentId: group.id }),
      sampleObject('shape', 'outside', { x: 500, y: 500 }),
      sampleObject('connector', 'link', {
        from: { kind: 'object', objectId: id('inner'), anchor: null },
        to: { kind: 'object', objectId: id('outside'), anchor: null },
      }),
      sampleObject('connector', 'spare', {
        from: { kind: 'object', objectId: id('outside'), anchor: null },
        to: { kind: 'point', x: 0, y: 0 },
      }),
      sampleObject('comment', 'pin', {
        anchor: { kind: 'object', objectId: id('link'), offset: { x: 1, y: 1 } },
      }),
    ]),
  );
}

describe('cascadeDelete', () => {
  it('deletes the objects and all their descendants, and detaches connectors by default', () => {
    const result = cascadeDelete(scene(), [id('frame')]);
    expect(result.deletedIds).toEqual(['frame', 'group', 'inner']);
    expect(result.updatedIds).toEqual(['link']);
    expect([...result.board.objects.keys()].sort()).toEqual(['link', 'outside', 'pin', 'spare']);
    const link = result.board.objects.get(id('link'));
    expect(link?.type === 'connector' && link.from.kind).toBe('point');
    expect(validateBoard(result.board)).toEqual([]);
  });

  it('deletes attached connectors instead under the delete policy, detaching comments pinned to them', () => {
    const result = cascadeDelete(scene(), [id('group')], { connectorPolicy: 'delete' });
    expect(result.deletedIds).toEqual(['group', 'inner', 'link']);
    expect(result.updatedIds).toEqual(['pin']);
    expect(result.board.objects.get(id('pin'))).toMatchObject({ anchor: { kind: 'point' } });
    expect(validateBoard(result.board)).toEqual([]);
  });

  it('never detaches or deletes a connector attached only to surviving objects', () => {
    const board = scene();
    const result = cascadeDelete(board, [id('frame')], { connectorPolicy: 'delete' });
    expect(result.board.objects.get(id('spare'))).toBe(board.objects.get(id('spare')));
  });

  it('returns an equal board and empty change lists when no requested id is on the board', () => {
    const board = scene();
    const result = cascadeDelete(board, [id('missing')]);
    expect(result.deletedIds).toEqual([]);
    expect(result.updatedIds).toEqual([]);
    expect(result.board.objects).toEqual(board.objects);
  });

  it('never mutates its input board', () => {
    const board = scene();
    const before = new Map(board.objects);
    cascadeDelete(board, [id('frame'), id('outside')], { connectorPolicy: 'delete' });
    expect(board.objects).toEqual(before);
  });
});

describe('cascadeDelete at the 50k-object budget', () => {
  it('deletes a group of 40,000 children with connectors attached, detaching them at the group bounds', () => {
    const group = sampleObject('group', 'big', { x: 0, y: 0 });
    const children = [...Array(40_000).keys()].map((index) =>
      sampleObject('shape', `s${String(index)}`, {
        parentId: group.id,
        x: index,
        y: 0,
        width: 1,
        height: 10,
      }),
    );
    const connectors = [...Array(20).keys()].map((index) =>
      sampleObject('connector', `c${String(index)}`, {
        x: 0,
        y: 0,
        from: { kind: 'object', objectId: group.id, anchor: { x: 1, y: 1 } },
      }),
    );
    const result = cascadeDelete(createBoard([group, ...children, ...connectors]), [group.id]);
    expect(result.deletedIds).toHaveLength(40_001);
    expect(result.updatedIds).toHaveLength(20);
    expect(result.board.objects.get(id('c7'))).toMatchObject({
      from: { kind: 'point', x: 40_000, y: 10 },
    });
  });
});
