// With: a delete past `MAX_OBJECTS_PER_TRANSACTION` runs in parts, one undo step
// whose undo re-creates one part per transaction, the last part first (referents before
// referrers). The door guard works per part and remembers, across the parts, the objects it left
// out, so a later part does not re-attach a connector on the board to one; what a later part
// re-creates inside one comes back, re-rooted by the history's reference repair (fix round 1).
import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { MAX_OBJECTS_PER_TRANSACTION } from '../commands/create-objects-parts.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import {
  ADA_PRINCIPAL,
  FAR_WIDTH,
  judgedRestore,
  mergeRaw,
  runAsAda,
} from './__fixtures__/door-fixtures.js';
import { createHistory } from './undo-manager.js';

const COUNT = MAX_OBJECTS_PER_TRANSACTION + 200;
const STROKE = { color: [0, 0, 0, 1], width: 2 };

/**
 * A shape as `createObjects` lists it.
 *
 * @param id - Its id in the list.
 * @param x - Its x.
 * @param parentId - Its parent in the list, or the root.
 * @returns The shape.
 */
function listedShape(id: string, x: number, parentId?: string) {
  return {
    id,
    type: 'shape',
    ...(parentId === undefined ? {} : { parentId }),
    x,
    y: 0,
    width: 2,
    height: 2,
    kind: 'rectangle',
    stroke: STROKE,
    fill: null,
    cornerRadius: 0,
    sides: 4,
    label: null,
  };
}

/** The pasted board's objects, by role. */
interface Pasted {
  readonly store: YjsDocumentStore;
  readonly frame: ObjectId;
  /** The sixth shape in the frame, which a connector from outside is attached to. */
  readonly target: ObjectId;
  readonly link: ObjectId;
}

/**
 * Pastes a frame holding {@link COUNT} shapes, a shape outside it, and a connector from that
 * shape to the frame's sixth shape; the paste's own undo step is dropped from the history used
 * after.
 *
 * @returns The store and the ids.
 */
function pastedBoard(): Pasted {
  const store = new YjsDocumentStore();
  const frame = {
    id: 'frame',
    type: 'frame',
    x: 0,
    y: 100,
    width: 5_000,
    height: 50,
    name: 'F',
    clip: false,
    background: null,
  };
  const shapes = Array.from({ length: COUNT }, (unused, index) =>
    listedShape(`s${String(index)}`, index * 3, 'frame'),
  );
  const link = {
    id: 'link',
    type: 'connector',
    x: 0,
    y: 0,
    from: { kind: 'object', objectId: 'out', anchor: null },
    to: { kind: 'object', objectId: 's5', anchor: null },
    route: 'straight',
    stroke: STROKE,
    startCap: 'none',
    endCap: 'arrow',
    label: null,
  };
  const objects = [frame, ...shapes, listedShape('out', 0), link];
  runAsAda(store, 'createObjects', { objects, parentId: null }, 12);
  const all: BoardObject[] = [...store.read().objects.values()];
  const find = (test: (object: BoardObject) => boolean): ObjectId => {
    const found = all.find(test);
    if (found === undefined) throw new Error('the paste wrote no such object');
    return found.id;
  };
  const frameId = find(({ type }) => type === 'frame');
  return {
    store,
    frame: frameId,
    target: find((object) => object.parentId === frameId && object.x === 15),
    link: find(({ type }) => type === 'connector'),
  };
}

describe('the undo of a delete in parts on a board holding a value the door refuses', () => {
  it('leaves out the poisoned object and re-creates the rest, each part passing the door', () => {
    const { store, frame, target, link } = pastedBoard();
    mergeRaw(store, target, 'size', { width: FAR_WIDTH });
    const history = createHistory(store, ADA_PRINCIPAL);
    runAsAda(store, 'deleteObjects', { ids: [frame] }, 13);
    const undone = judgedRestore(store, history, 'undo');
    expect(undone).toMatchObject({
      isChanged: true,
      omission: 'out-of-range',
      omittedObjects: 1,
      findings: [],
    });
    expect(undone.updateCount).toBeGreaterThan(1);
    expect(store.get(target)).toBeUndefined();
    expect(store.read().objects.size).toBe(COUNT + 2);
    expect(mustGet(store, link)).toMatchObject({ to: { kind: 'point' } });
    expect(judgedRestore(store, history, 'redo')).toMatchObject({ findings: [] });
    expect(store.read().objects.size).toBe(2);
  });

  it('leaves out only a poisoned frame: its shapes come back re-rooted, in one step of parts', () => {
    const { store, frame, target, link } = pastedBoard();
    mergeRaw(store, frame, 'size', { width: FAR_WIDTH });
    const history = createHistory(store, ADA_PRINCIPAL);
    const before = mustGet(store, target);
    runAsAda(store, 'deleteObjects', { ids: [frame] }, 13);
    const undone = judgedRestore(store, history, 'undo');
    expect(undone).toMatchObject({
      isChanged: true,
      omission: 'out-of-range',
      omittedObjects: 1,
      findings: [],
    });
    expect(undone.updateCount).toBeGreaterThan(1);
    expect(history.canUndo()).toBe(false);
    expect(store.get(frame)).toBeUndefined();
    const shapes = [...store.read().objects.values()].filter(({ type }) => type === 'shape');
    expect(shapes).toHaveLength(COUNT + 1);
    // Re-rooted by the history's reference repair where they were: the frame's place added in.
    expect(shapes.every(({ parentId }) => parentId === null)).toBe(true);
    expect(mustGet(store, target)).toMatchObject({ x: before.x, y: before.y + 100 });
    expect(mustGet(store, link)).toMatchObject({ to: { kind: 'object', objectId: target } });
    // Undo, redo, undo: the same board.
    const restored = new Map(store.read().objects);
    expect(judgedRestore(store, history, 'redo')).toMatchObject({ findings: [] });
    expect(store.read().objects.size).toBe(2);
    expect(judgedRestore(store, history, 'undo')).toMatchObject({ findings: [] });
    expect(new Map(store.read().objects)).toEqual(restored);
  });
});
