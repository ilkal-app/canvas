import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  applyCommand,
  expectRejected,
  mustGet,
} from '../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { resizeObjectsCommand } from '../commands/resize-objects.js';
import { ungroupCommand } from '../commands/ungroup.js';

import {
  fixtureGateBoard,
  letStayBoard,
  mergeGroup,
  rawUpdate,
  setRawContent,
  writerUpdate,
  type RawContentKind,
} from './__fixtures__/gate-boards.js';
import { UpdateStampCheck } from './update-stamp-check.js';

// The door check, fix round 1 of part 1. C1: a value is judged whatever content wrote it
// (`Y.Map#get` returns JSON and embeds as plain values; `JSON.parse('1e999')` is Infinity), and
// any other content under a judged key is refused. I1: a field an update writes as the hub
// already holds it is not judged, so an honest command that rewrites a value lets stay
// lands, while a changed value is still judged.

/** Where each judged group lives on the fixture board, with an honest and a hostile JSON text. */
const GROUPS: readonly {
  readonly name: string;
  readonly objectId: string;
  readonly key: string;
  readonly network?: string;
  readonly honest: string;
  readonly hostile: string;
  readonly field: string;
}[] = [
  {
    name: 'placement',
    objectId: 'sticky-idea',
    key: 'placement',
    honest: '{"parentId":"frame-plan","x":40,"y":120,"rotation":0}',
    hostile: '{"parentId":"frame-plan","x":1e999,"y":120,"rotation":0}',
    field: 'x',
  },
  {
    name: 'size',
    objectId: 'sticky-idea',
    key: 'size',
    honest: '{"width":200,"height":200}',
    hostile: '{"width":1e20,"height":200}',
    field: 'width',
  },
  {
    name: 'rotation',
    objectId: 'sticky-idea',
    key: 'placement',
    honest: '{"parentId":"frame-plan","x":40,"y":120,"rotation":3}',
    hostile: '{"parentId":"frame-plan","x":40,"y":120,"rotation":1e300}',
    field: 'rotation',
  },
  {
    name: 'line end',
    objectId: 'line-divider',
    key: 'points.1',
    honest: '{"x":1200,"y":5}',
    hostile: '{"x":1200,"y":-1e999}',
    field: 'y',
  },
  {
    name: 'crop',
    objectId: 'image-photo',
    key: 'style',
    honest:
      '{"crop":{"x":0.1,"y":0,"width":0.8,"height":1},"naturalSize":{"width":4000,"height":2400}}',
    hostile:
      '{"crop":{"x":0.5,"y":0,"width":0.8,"height":1},"naturalSize":{"width":4000,"height":2400}}',
    field: 'crop',
  },
  {
    name: 'natural size',
    objectId: 'image-photo',
    key: 'style',
    honest:
      '{"crop":{"x":0.1,"y":0,"width":0.8,"height":1},"naturalSize":{"width":4000,"height":2400}}',
    hostile:
      '{"crop":{"x":0.1,"y":0,"width":0.8,"height":1},"naturalSize":{"width":0.5,"height":2400}}',
    field: 'naturalSize.width',
  },
  {
    name: 'vertex',
    objectId: 'path-squiggle',
    key: 'v2',
    network: 'vertices',
    honest: '[1,{"id":"v2","x":110,"y":0,"mirror":"both"}]',
    hostile: '[1,{"id":"v2","x":1e999,"y":0,"mirror":"both"}]',
    field: 'x',
  },
  {
    name: 'handle',
    objectId: 'path-squiggle',
    key: 's1',
    network: 'segments',
    honest: '[0,{"id":"s1","a":"v1","b":"v2","ha":{"x":1,"y":0},"hb":{"x":0,"y":0}}]',
    hostile: '[0,{"id":"s1","a":"v1","b":"v2","ha":{"x":1,"y":0},"hb":{"x":0,"y":1e999}}]',
    field: 'hb.y',
  },
];

/**
 * Checks a raw write of content of a kind under a judged key of the fixture board.
 *
 * @param group - Where it goes.
 * @param kind - The content kind.
 * @param text - Its text.
 * @returns The verdict.
 */
function checkContent(
  group: (typeof GROUPS)[number],
  kind: RawContentKind,
  text: string,
): ReturnType<UpdateStampCheck['check']> {
  const board = fixtureGateBoard();
  const update = rawUpdate(board, (objects) => {
    const object = objects.get(group.objectId);
    const map =
      group.network === undefined ? object : (object?.get(group.network) as Y.Map<unknown>);
    if (map === undefined) throw new Error(`no map for ${group.name}`);
    setRawContent(map, group.key, kind, text);
  });
  return new UpdateStampCheck(board.hub).check(update);
}

describe('UpdateStampCheck: values written as JSON or an embed', () => {
  for (const group of GROUPS) {
    for (const kind of ['json', 'embed'] as const) {
      it(`judges a ${group.name} written as ${kind}: in range passes, out of range is refused`, () => {
        expect(checkContent(group, kind, group.honest)).toEqual({ kind: 'accepted' });
        const verdict = checkContent(group, kind, group.hostile);
        expect(verdict).toMatchObject({
          kind: 'accepted',
          hostileValue: { objectId: group.objectId, field: group.field },
        });
      });
    }
  }

  it('refuses a string, binary, a shared type or unparseable JSON under a judged key', () => {
    const [placement, , , , , , vertex] = GROUPS;
    if (placement === undefined || vertex === undefined) throw new Error('no groups');
    for (const [kind, text] of [
      ['string', 'x'],
      ['binary', ''],
      ['json', '{"x":'],
      ['embed', 'not json'],
    ] as const) {
      for (const group of [placement, vertex]) {
        expect(checkContent(group, kind, text), `${kind} ${group.name}`).toMatchObject({
          hostileValue: { objectId: group.objectId, field: '', reason: 'not-a-plain-value' },
        });
      }
    }
    const board = fixtureGateBoard();
    const update = rawUpdate(board, (objects) => {
      objects.get('sticky-idea')?.set('size', new Y.Map<unknown>([['width', 1]]));
    });
    expect(new UpdateStampCheck(board.hub).check(update)).toMatchObject({
      hostileValue: { objectId: 'sticky-idea', key: 'size', reason: 'not-a-plain-value' },
    });
  });

  it('refuses a judged field that is not a number, and a judged value that is not a record', () => {
    const board = fixtureGateBoard();
    const check = new UpdateStampCheck(board.hub);
    const stringX = rawUpdate(board, (objects) => {
      mergeGroup(objects, 'sticky-idea', 'placement', { x: '40' });
    });
    expect(check.check(stringX)).toMatchObject({
      hostileValue: { key: 'placement', field: 'x', reason: 'not-a-number' },
    });
    const nullSize = rawUpdate(board, (objects) => {
      objects.get('sticky-idea')?.set('size', null);
    });
    expect(check.check(nullSize)).toMatchObject({
      hostileValue: { key: 'size', field: '', reason: 'not-a-record' },
    });
  });
});

describe('UpdateStampCheck: a rewrite of what the hub holds', () => {
  it('lets an honest move rewrite a rotation let stay', () => {
    const board = letStayBoard();
    const update = writerUpdate(board, (writer) => {
      applyCommand(writer, moveObjectsCommand, { moves: [{ id: 'tilted', by: { x: 1, y: 0 } }] });
      expect(mustGet(writer, 'tilted')).toMatchObject({ x: 11, rotation: 1e300 });
    });
    expect(new UpdateStampCheck(board.hub).check(update)).toEqual({ kind: 'accepted' });
  });

  it('lets an honest ungroup rewrite the placement of a child holding such a rotation', () => {
    const board = letStayBoard();
    const update = writerUpdate(board, (writer) => {
      applyCommand(writer, ungroupCommand, { ids: ['g'] });
      // Ungroup turns the child by the group's rotation and normalises the angle it writes.
      expect(mustGet(writer, 'inner')).toMatchObject({ parentId: null });
    });
    expect(new UpdateStampCheck(board.hub).check(update)).toEqual({ kind: 'accepted' });
  });

  it('takes a rewrite of a width past 2^32 the hub holds, and judges one it changes', () => {
    const board = letStayBoard();
    // Commands no longer write a size the door refuses, even one the board holds (the
    // hub may have repaired it meanwhile, and the door would close the writer for good)...
    expect(
      expectRejected(board.writer, resizeObjectsCommand, {
        resizes: [{ id: 'wide', to: { width: 2 ** 33, height: 50 } }],
      }),
    ).toEqual([expect.objectContaining({ code: 'invalid-object', path: ['width'] })]);
    // ...but the door still takes such a rewrite when it equals what the hub holds, as an older
    // build's command writes it.
    const keep = rawUpdate(board, (objects) => {
      mergeGroup(objects, 'wide', 'size', { width: 2 ** 33, height: 50 });
    });
    expect(new UpdateStampCheck(board.hub).check(keep)).toEqual({ kind: 'accepted' });
    const inward = letStayBoard();
    // Smaller, but changed and still past the range: the command refuses it itself, naming the
    // field (item 1), and the door refuses the same value written raw.
    const errors = expectRejected(inward.writer, resizeObjectsCommand, {
      resizes: [{ id: 'wide', to: { width: 2 ** 32 + 2, height: 100 } }],
    });
    expect(errors).toEqual([
      expect.objectContaining({ code: 'invalid-object', objectId: 'wide', path: ['width'] }),
    ]);
    const update = rawUpdate(inward, (objects) => {
      mergeGroup(objects, 'wide', 'size', { width: 2 ** 32 + 2, height: 100 });
    });
    expect(new UpdateStampCheck(inward.hub).check(update)).toMatchObject({
      hostileValue: { objectId: 'wide', key: 'size', field: 'width', reason: 'past-extent' },
    });
  });

  it('still refuses a changed hostile value on the same object', () => {
    const board = letStayBoard();
    const update = rawUpdate(board, (objects) => {
      mergeGroup(objects, 'tilted', 'placement', { rotation: 1e299 });
    });
    expect(new UpdateStampCheck(board.hub).check(update)).toMatchObject({
      hostileValue: { objectId: 'tilted', key: 'placement', field: 'rotation' },
    });
  });
});
