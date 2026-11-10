import { describe, expect, it } from 'vitest';

import { createBoard, type Board } from '../board/board.js';
import type { ObjectId } from '../ids/object-id.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import type { BoardObject } from '../objects/board-object.js';

import { validateBoard } from './validate-board.js';

const id = (value: string): ObjectId => value as ObjectId;

describe('validateBoard', () => {
  it('reports nothing for a board whose references all resolve', () => {
    const frame = sampleObject('frame', 'frame');
    const group = sampleObject('group', 'group', { parentId: frame.id });
    const shape = sampleObject('shape', 'shape', { parentId: group.id });
    const connector = sampleObject('connector', 'conn', {
      from: { kind: 'object', objectId: shape.id, anchor: null },
      to: { kind: 'object', objectId: frame.id, anchor: { x: 1, y: 0.5 } },
    });
    const comment = sampleObject('comment', 'note', {
      anchor: { kind: 'object', objectId: connector.id, offset: { x: 0, y: 0 } },
    });
    expect(validateBoard(createBoard([frame, group, shape, connector, comment]))).toEqual([]);
  });

  it('reports a parent that is missing, that is not a group or frame, or that is the object itself', () => {
    const shape = sampleObject('shape', 'shape');
    const board = createBoard([
      shape,
      sampleObject('text', 'orphan', { parentId: id('gone') }),
      sampleObject('text', 'in-shape', { parentId: shape.id }),
      sampleObject('group', 'self', { parentId: id('self') }),
    ]);
    expect(validateBoard(board)).toEqual([
      {
        code: 'invalid-parent',
        objectId: 'in-shape',
        relatedId: 'shape',
        path: ['parentId'],
        message: 'parent "shape" is a shape; only a group or frame can hold children',
      },
      {
        code: 'missing-parent',
        objectId: 'orphan',
        relatedId: 'gone',
        path: ['parentId'],
        message: 'parent "gone" is not on the board',
      },
      {
        code: 'parent-cycle',
        objectId: 'self',
        relatedId: 'self',
        path: ['parentId'],
        message: 'the ancestors of "self" lead back to it',
      },
    ]);
  });

  it('reports each object on a longer parent cycle once', () => {
    const board = createBoard([
      sampleObject('group', 'a', { parentId: id('b') }),
      sampleObject('frame', 'b', { parentId: id('a') }),
      sampleObject('shape', 'leaf', { parentId: id('a') }),
    ]);
    expect(validateBoard(board).map((issue) => [issue.code, issue.objectId])).toEqual([
      ['parent-cycle', 'a'],
      ['parent-cycle', 'b'],
    ]);
  });

  it('reports connector ends whose target is missing, is itself, or is a connector or comment', () => {
    const other = sampleObject('connector', 'other');
    const comment = sampleObject('comment', 'pin');
    const board = createBoard([
      other,
      comment,
      sampleObject('connector', 'c1', {
        from: { kind: 'object', objectId: id('gone'), anchor: null },
        to: { kind: 'object', objectId: id('c1'), anchor: null },
      }),
      sampleObject('connector', 'c2', {
        from: { kind: 'object', objectId: other.id, anchor: null },
        to: { kind: 'object', objectId: comment.id, anchor: null },
      }),
    ]);
    expect(
      validateBoard(board).map((issue) => [
        issue.code,
        issue.objectId,
        issue.path.join('.'),
        issue.relatedId,
      ]),
    ).toEqual([
      ['missing-connector-target', 'c1', 'from.objectId', 'gone'],
      ['invalid-connector-target', 'c1', 'to.objectId', 'c1'],
      ['invalid-connector-target', 'c2', 'from.objectId', 'other'],
      ['invalid-connector-target', 'c2', 'to.objectId', 'pin'],
    ]);
  });

  it('reports a comment anchored to a missing object or to a comment', () => {
    const board = createBoard([
      sampleObject('comment', 'm1', {
        anchor: { kind: 'object', objectId: id('gone'), offset: { x: 0, y: 0 } },
      }),
      sampleObject('comment', 'm2', {
        anchor: { kind: 'object', objectId: id('m1'), offset: { x: 0, y: 0 } },
      }),
    ]);
    expect(
      validateBoard(board).map((issue) => [issue.code, issue.objectId, issue.relatedId]),
    ).toEqual([
      ['missing-comment-anchor', 'm1', 'gone'],
      ['invalid-comment-anchor', 'm2', 'm1'],
    ]);
  });

  it('reports an object stored under a key other than its id', () => {
    const shape = sampleObject('shape', 'real');
    const board: Board = { objects: new Map<ObjectId, BoardObject>([[id('alias'), shape]]) };
    expect(
      validateBoard(board).map((issue) => [issue.code, issue.objectId, issue.relatedId]),
    ).toEqual([['id-mismatch', 'alias', 'real']]);
  });
});
