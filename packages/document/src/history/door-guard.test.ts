// An undo or redo never writes a value the relay's door refuses. A peer leaves such a
// value on the fixture board by a raw update (as a board stored before the door existed holds
// it); Ada runs honest commands through the command layer and undoes them through her history;
// every update is judged as the relay's door judges it (`judgeFieldWrites`).
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { findNetworkIssues } from '@canvas/schema';

import { mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import {
  ADA_PRINCIPAL,
  FAR_WIDTH,
  judgedRestore,
  mergeRaw,
  runAsAda,
  writeRaw,
} from './__fixtures__/door-fixtures.js';
import { pathOf } from './__fixtures__/network-member-fixtures.js';
import { createHistory } from './undo-manager.js';

/**
 * The fixture board with Ada's history.
 *
 * @returns The store and the history.
 */
function board() {
  const store = createFixtureStore();
  return { store, history: createHistory(store, ADA_PRINCIPAL) };
}

describe('an undo of a write over a value the door refuses', () => {
  it('keeps the write, restores the rest of the step, and says out-of-range', () => {
    const { store, history } = board();
    mergeRaw(store, 'shape-box', 'size', { width: FAR_WIDTH });
    runAsAda(store, 'resizeObjects', {
      resizes: [{ id: 'shape-box', to: { width: 10, height: 100 } }],
    });
    const undone = judgedRestore(store, history, 'undo');
    expect(undone).toMatchObject({ omission: 'out-of-range', findings: [], updateCount: 1 });
    expect(mustGet(store, 'shape-box')).toMatchObject({ width: 10, height: 100 });
    // Used up: the redo reapplies only what the undo applied, and passes the door too.
    const redone = judgedRestore(store, history, 'redo');
    expect(redone).toMatchObject({ omission: undefined, findings: [] });
    expect(mustGet(store, 'shape-box')).toMatchObject({ width: 10 });
    expect(history.canRedo()).toBe(false);
  });

  it('restores a value the door refuses when it equals what the board holds again', () => {
    const { store, history } = board();
    mergeRaw(store, 'shape-box', 'placement', { rotation: 1e300 });
    runAsAda(store, 'moveObjects', { moves: [{ id: 'shape-box', by: { x: 40, y: 0 } }] });
    const undone = judgedRestore(store, history, 'undo');
    expect(undone).toMatchObject({ isChanged: true, omission: undefined, findings: [] });
    expect(mustGet(store, 'shape-box')).toMatchObject({ x: 0, rotation: 1e300 });
  });

  it('freezes a network with a refused member: no member is restored or removed', () => {
    const { store, history } = board();
    writeRaw(store, 'path-squiggle', (map) => {
      const vertices = map.get('vertices') as Y.Map<unknown>;
      const [order] = vertices.get('v2') as [number, unknown];
      vertices.set('v2', [order, { id: 'v2', x: Number.NaN, y: 0, mirror: 'both' }]);
    });
    runAsAda(store, 'editNetwork', {
      id: 'path-squiggle',
      setVertices: [{ id: 'v2', x: 150, y: 0, mirror: 'both' }],
      setSegments: [{ id: 's1', a: 'v1', b: 'v2', ha: { x: 0, y: 0 }, hb: { x: -10, y: 0 } }],
    });
    const before = pathOf(store);
    const undone = judgedRestore(store, history, 'undo');
    expect(undone).toMatchObject({ omission: 'out-of-range', findings: [] });
    const path = pathOf(store);
    expect(path.vertices).toEqual(before.vertices);
    expect(path.segments).toEqual(before.segments);
    expect(findNetworkIssues(path.vertices, path.segments)).toEqual([]);
  });
});

describe('an undo of a delete of an object holding a value the door refuses', () => {
  it('does not re-create it, and leaves the connector attached to it detached', () => {
    const { store, history } = board();
    mergeRaw(store, 'shape-box', 'size', { width: FAR_WIDTH });
    runAsAda(store, 'deleteObjects', { ids: ['shape-box'] });
    const undone = judgedRestore(store, history, 'undo');
    expect(undone).toMatchObject({
      omission: 'out-of-range',
      omittedObjects: 1,
      findings: [],
      updateCount: 1,
    });
    expect(store.get('shape-box' as never)).toBeUndefined();
    expect(mustGet(store, 'connector-flow')).toMatchObject({ to: { kind: 'point' } });
    expect(history.canUndo()).toBe(false);
  });

  it('leaves out only it: what lay in it comes back re-rooted, and the rest of the step applies', () => {
    const { store, history } = board();
    mergeRaw(store, 'group-diagram', 'placement', { rotation: 1e300 });
    runAsAda(store, 'deleteObjects', { ids: ['group-diagram', 'image-photo'] });
    const undone = judgedRestore(store, history, 'undo');
    expect(undone).toMatchObject({
      isChanged: true,
      omission: 'out-of-range',
      omittedObjects: 1,
      findings: [],
    });
    expect(store.get('group-diagram' as never)).toBeUndefined();
    for (const id of ['shape-box', 'shape-star']) {
      const member = mustGet(store, id);
      // Re-rooted by the history's reference repair into the group's parent, where it was.
      expect(member.parentId).toBe('frame-plan');
      expect([member.x, member.y, member.rotation].every(Number.isFinite)).toBe(true);
    }
    expect(mustGet(store, 'image-photo')).toMatchObject({ width: 400 });
    expect(mustGet(store, 'comment-on-photo')).toMatchObject({
      anchor: { kind: 'object', objectId: 'image-photo' },
    });
    expect(mustGet(store, 'connector-flow')).toMatchObject({
      to: { kind: 'object', objectId: 'shape-box' },
    });
    // The redo deletes again only what the undo re-created, and passes the door.
    expect(judgedRestore(store, history, 'redo')).toMatchObject({ findings: [] });
    expect(store.get('image-photo' as never)).toBeUndefined();
    expect(judgedRestore(store, history, 'undo')).toMatchObject({ findings: [] });
    expect(mustGet(store, 'image-photo')).toMatchObject({ width: 400 });
  });

  it('re-roots what lay in a frame whose own place is not finite, with finite coordinates', () => {
    const { store, history } = board();
    mergeRaw(store, 'frame-plan', 'placement', { x: Number.POSITIVE_INFINITY });
    runAsAda(store, 'deleteObjects', { ids: ['frame-plan'] });
    const undone = judgedRestore(store, history, 'undo');
    expect(undone).toMatchObject({ omission: 'out-of-range', omittedObjects: 1, findings: [] });
    expect(store.get('frame-plan' as never)).toBeUndefined();
    for (const id of ['text-title', 'sticky-idea', 'group-diagram']) {
      const child = mustGet(store, id);
      expect(child.parentId).toBeNull();
      expect([child.x, child.y, child.rotation].every(Number.isFinite)).toBe(true);
    }
    expect(mustGet(store, 'shape-box').parentId).toBe('group-diagram');
  });

  it('re-creates a comment the step deleted with it, pinned where it was', () => {
    const { store, history } = board();
    mergeRaw(store, 'image-photo', 'style', { crop: { x: -1, y: 0, width: 0.5, height: 1 } });
    runAsAda(store, 'deleteObjects', { ids: ['image-photo', 'comment-on-photo', 'sticky-idea'] });
    const undone = judgedRestore(store, history, 'undo');
    expect(undone).toMatchObject({ omission: 'out-of-range', omittedObjects: 1, findings: [] });
    expect(store.get('image-photo' as never)).toBeUndefined();
    expect(mustGet(store, 'comment-on-photo')).toMatchObject({ anchor: { kind: 'point' } });
    expect(mustGet(store, 'sticky-idea')).toMatchObject({ width: 200 });
    expect(mustGet(store, 'connector-flow')).toMatchObject({
      from: { kind: 'object', objectId: 'sticky-idea' },
    });
  });

  it('turns a comment pinned on it into a point pin, as the delete left it', () => {
    const { store, history } = board();
    mergeRaw(store, 'image-photo', 'style', { naturalSize: { width: 0.5, height: 2400 } });
    runAsAda(store, 'deleteObjects', { ids: ['image-photo'] });
    const undone = judgedRestore(store, history, 'undo');
    expect(undone).toMatchObject({ omission: 'out-of-range', omittedObjects: 1, findings: [] });
    expect(mustGet(store, 'comment-on-photo')).toMatchObject({ anchor: { kind: 'point' } });
  });

  it('is silent when nothing the step restores is refused', () => {
    const { store, history } = board();
    mergeRaw(store, 'shape-box', 'size', { width: FAR_WIDTH });
    runAsAda(store, 'deleteObjects', { ids: ['image-photo'] });
    const undone = judgedRestore(store, history, 'undo');
    expect(undone).toMatchObject({
      isChanged: true,
      omission: undefined,
      omittedObjects: 0,
      findings: [],
    });
    expect(mustGet(store, 'image-photo')).toMatchObject({ width: 400 });
  });
});
