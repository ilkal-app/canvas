import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { BOARD_BOUND, DRAWABLE_EXTENT } from '@canvas/schema';

import { layoutOf } from '../codec/object-layout.js';
import {
  applyCommand,
  expectRejected,
  mustGet,
} from '../commands/__fixtures__/command-fixtures.js';
import { createObjectCommand } from '../commands/create-object.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { BOB } from '../store/__fixtures__/store-fixtures.js';
import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';

import {
  fixtureGateBoard,
  longPath,
  mergeGroup,
  moveUpdate,
  noteBoard,
  rawUpdate,
  writerUpdate,
} from './__fixtures__/gate-boards.js';
import { DOCUMENT_META_KEY, META_MAP_NAME } from './document-meta.js';
import { UpdateStampCheck } from './update-stamp-check.js';

// The door check of incoming values (part 1): an update the stamp check accepts has the
// values it writes into objects judged from the same replay, wherever Yjs puts them: into a map
// the board holds, into a map the same update creates, or into a network one or two levels down.

/**
 * Checks an update against the fixture board's hub.
 *
 * @param change - The raw change.
 * @param isCollecting - Whether the writer's document collects deleted content.
 * @returns The verdict.
 */
function checkRaw(
  change: Parameters<typeof rawUpdate>[1],
  isCollecting = true,
): ReturnType<UpdateStampCheck['check']> {
  const board = fixtureGateBoard();
  return new UpdateStampCheck(board.hub).check(rawUpdate(board, change, isCollecting));
}

/**
 * The map a stored object holds under a key.
 *
 * @param objects - The `objects` map.
 * @param objectId - The object.
 * @param key - The key.
 * @returns The map.
 * @throws {Error} When there is no map there.
 */
function nestedMap(objects: Y.Map<Y.Map<unknown>>, objectId: string, key: string): Y.Map<unknown> {
  const value = objects.get(objectId)?.get(key);
  if (!(value instanceof Y.Map)) throw new Error(`no map under ${objectId}.${key}`);
  return value as Y.Map<unknown>;
}

describe('UpdateStampCheck: the door check of values', () => {
  it('accepts honest writes with nothing to report: a move, and a 1,000-vertex path', () => {
    const board = noteBoard(10);
    const check = new UpdateStampCheck(board.hub);
    expect(check.check(moveUpdate(board, 3))).toEqual({ kind: 'accepted' });
    const path = writerUpdate(board, (writer) => {
      writer.transact(BOB, (transaction) => {
        transaction.setObject(longPath(1_000));
      });
    });
    expect(check.check(path)).toEqual({ kind: 'accepted' });
  });

  it.each([
    ['a NaN x', 'placement', { x: Number.NaN }, 'x', 'not-finite'],
    ['an infinite y', 'placement', { y: Number.NEGATIVE_INFINITY }, 'y', 'not-finite'],
    ['a rotation past float32', 'placement', { rotation: 2 ** 128 }, 'rotation', 'out-of-range'],
    ['an infinite width', 'size', { width: Number.POSITIVE_INFINITY }, 'width', 'not-finite'],
    ['a height past 2^32', 'size', { height: 2 ** 32 + 1 }, 'height', 'past-extent'],
    ['a negative width', 'size', { width: -1 }, 'width', 'negative-size'],
  ])('refuses %s in a note the board holds', (label, group, fields, field, reason) => {
    const verdict = checkRaw((objects) => {
      mergeGroup(objects, 'sticky-idea', group, fields);
    });
    expect(verdict).toEqual({
      kind: 'accepted',
      hostileValue: { objectId: 'sticky-idea', key: group, field, reason },
    });
  });

  it('refuses an image crop past the image and a natural size that is not whole', () => {
    expect(
      checkRaw((objects) => {
        mergeGroup(objects, 'image-photo', 'style', {
          crop: { x: 0.5, y: 0, width: 0.6, height: 1 },
        });
      }),
    ).toMatchObject({ hostileValue: { key: 'style', field: 'crop', reason: 'out-of-range' } });
    expect(
      checkRaw((objects) => {
        mergeGroup(objects, 'image-photo', 'style', { naturalSize: { width: 1e-200, height: 1 } });
      }),
    ).toMatchObject({
      hostileValue: { key: 'style', field: 'naturalSize.width', reason: 'out-of-range' },
    });
  });

  it('refuses a line end at NaN under its own key', () => {
    expect(
      checkRaw((objects) => {
        objects.get('line-divider')?.set('points.1', { x: Number.NaN, y: 0 });
      }),
    ).toEqual({
      kind: 'accepted',
      hostileValue: {
        objectId: 'line-divider',
        key: 'points.1',
        field: 'x',
        reason: 'not-finite',
      },
    });
  });

  it('refuses a vertex and a handle written into the network of a path the board holds', () => {
    expect(
      checkRaw((objects) => {
        nestedMap(objects, 'path-squiggle', 'vertices').set('v2', [
          1,
          { id: 'v2', x: Number.POSITIVE_INFINITY, y: 0, mirror: 'both' },
        ]);
      }),
    ).toEqual({
      kind: 'accepted',
      hostileValue: {
        objectId: 'path-squiggle',
        key: 'vertices',
        memberId: 'v2',
        field: 'x',
        reason: 'not-finite',
      },
    });
    expect(
      checkRaw((objects) => {
        nestedMap(objects, 'path-squiggle', 'segments').set('s1', [
          0,
          { id: 's1', a: 'v1', b: 'v2', ha: { x: 0, y: 0 }, hb: { x: 0, y: Number.NaN } },
        ]);
      }),
    ).toMatchObject({
      hostileValue: { key: 'segments', memberId: 's1', field: 'hb.y', reason: 'not-finite' },
    });
  });

  it('refuses a value in an object, or a network, the same update creates', () => {
    const vertex = { id: 'v1', x: Number.NaN, y: 0, mirror: 'none' };
    expect(
      checkRaw((objects) => {
        objects.set(
          'evil',
          new Y.Map<unknown>([
            ['identity', { id: 'evil', type: 'path' }],
            ['vertices', new Y.Map<unknown>([['v1', [0, vertex]]])],
          ]),
        );
      }),
    ).toMatchObject({
      hostileValue: { objectId: 'evil', key: 'vertices', memberId: 'v1', reason: 'not-finite' },
    });
    expect(
      checkRaw((objects) => {
        objects.get('path-squiggle')?.set('vertices', new Y.Map<unknown>([['v1', [0, vertex]]]));
      }),
    ).toMatchObject({ hostileValue: { objectId: 'path-squiggle', memberId: 'v1' } });
    expect(
      checkRaw((objects) => {
        objects.set(
          'evil',
          new Y.Map<unknown>([['placement', { parentId: null, x: 0, y: Number.NaN, rotation: 0 }]]),
        );
      }),
    ).toMatchObject({ hostileValue: { objectId: 'evil', key: 'placement', field: 'y' } });
  });

  it('judges no value the update itself deletes, nor values outside objects', () => {
    const verdict = checkRaw((objects, doc) => {
      mergeGroup(objects, 'sticky-idea', 'placement', { x: Number.NaN });
      mergeGroup(objects, 'sticky-idea', 'placement', { x: 1 });
      doc.getMap<unknown>('auxiliary').set('placement', { x: Number.NaN });
      nestedMap(objects, 'shape-box', 'label').set('placement', { x: Number.NaN });
      objects.get('sticky-idea')?.set('z', Number.NaN);
    }, false);
    expect(verdict).toEqual({ kind: 'accepted' });
  });

  it('counts a whole line pair on a board of layout 2, in range, without refusing it', () => {
    const verdict = checkRaw((objects) => {
      objects.get('line-divider')?.set('points', [
        { x: 99, y: 99 },
        { x: 999, y: 999 },
      ]);
    });
    expect(verdict).toEqual({ kind: 'accepted', layoutShapedWrites: 1 });
    expect(layoutOf('line')?.keys.has('points.0')).toBe(true);
  });

  it('counts no whole pair on a board of layout 1, and refuses one out of range on either', () => {
    const hub = new Y.Doc();
    hub
      .getMap<unknown>(META_MAP_NAME)
      .set(DOCUMENT_META_KEY, { schemaVersion: 1, layoutVersion: 1 });
    hub.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).set('line', new Y.Map<unknown>());
    const pair = (end: number) => (objects: Y.Map<Y.Map<unknown>>) => {
      objects.get('line')?.set('points', [
        { x: 0, y: 0 },
        { x: end, y: 0 },
      ]);
    };
    const check = new UpdateStampCheck(hub);
    expect(check.check(rawUpdate({ hub }, pair(10)))).toEqual({ kind: 'accepted' });
    expect(check.check(rawUpdate({ hub }, pair(Number.NaN)))).toMatchObject({
      hostileValue: { objectId: 'line', key: 'points', field: '1.x', reason: 'not-finite' },
    });
  });

  it('never judges values on a durable history replay', () => {
    const board = fixtureGateBoard();
    const update = rawUpdate(board, (objects) => {
      mergeGroup(objects, 'sticky-idea', 'placement', { x: Number.NaN });
    });
    expect(new UpdateStampCheck(board.hub, undefined, true).check(update)).toEqual({
      kind: 'accepted',
    });
  });

  it('accepts what a command stores past 2^31: a child of a turned frame at the far corner', () => {
    const board = fixtureGateBoard();
    const far = BOARD_BOUND - 1_000;
    const offset = Math.SQRT2 * 2 * far;
    const update = writerUpdate(board, (writer) => {
      applyCommand(writer, createObjectCommand, {
        object: {
          id: 'tilted',
          type: 'frame',
          x: -far,
          y: -far,
          rotation: Math.PI / 4,
          width: 10,
          height: 10,
          name: 'T',
          clip: false,
          background: null,
        },
      });
      applyCommand(writer, createObjectCommand, {
        object: {
          id: 'far-child',
          parentId: 'tilted',
          type: 'frame',
          x: offset,
          y: 0,
          width: 10,
          height: 10,
          name: 'C',
          clip: false,
          background: null,
        },
      });
      expect(mustGet(writer, 'far-child').x).toBeGreaterThan(DRAWABLE_EXTENT);
    });
    expect(new UpdateStampCheck(board.hub).check(update)).toEqual({ kind: 'accepted' });
  });

  it('takes a coordinate of 1e308, which no command stores any more: an empty group moved by it', () => {
    // Item 4: placement is bounded regardless of extent, so the move is refused by the
    // board's bound; the door's coordinate rule stays "finite", and takes the value written raw.
    const board = fixtureGateBoard();
    const update = writerUpdate(board, (writer) => {
      applyCommand(writer, createObjectCommand, {
        object: { id: 'empty', type: 'group', x: 10, y: 10 },
      });
      const errors = expectRejected(writer, moveObjectsCommand, {
        moves: [{ id: 'empty', by: { x: 1e308, y: 0 } }],
      });
      expect(errors.map(({ code, objectId }) => [code, objectId])).toEqual([
        ['invalid-input', 'empty'],
      ]);
    });
    expect(new UpdateStampCheck(board.hub).check(update)).toEqual({ kind: 'accepted' });
    Y.applyUpdate(board.hub, update);
    const raw = rawUpdate(board, (objects) => {
      mergeGroup(objects, 'empty', 'placement', { x: 1e308 });
    });
    expect(new UpdateStampCheck(board.hub).check(raw)).toEqual({ kind: 'accepted' });
  });
});
