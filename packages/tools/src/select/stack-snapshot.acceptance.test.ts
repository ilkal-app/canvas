import { describe, expect, it } from 'vitest';

import type { AutoLayout, BoardObject, ObjectId } from '@canvas/schema';

import { move } from './__fixtures__/drag-snap-steps.js';
import { frame, id, indexOf, rect } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { DragDocument } from './drag-document.js';
import { SelectGesture } from './select-gesture.js';
import { createSelectHitTester } from './select-hit-tester.js';
import { selectionOf } from './selection-state.js';
import { stackSlotOf } from './stack-reorder.js';

const ROW: AutoLayout = {
  direction: 'row',
  gap: 10,
  padding: { top: 10, right: 10, bottom: 10, left: 10 },
  align: 'start',
  justify: 'start',
  width: 'fixed',
  height: 'fixed',
};
const OBJECTS: BoardObject[] = [
  { ...frame('row', null, { x: 100, y: 100, width: 300, height: 100 }), autoLayout: ROW },
  { ...rect('a', 'row', { x: 10, y: 10, width: 40, height: 40 }), z: 'a0' },
  { ...rect('b', 'row', { x: 60, y: 10, width: 40, height: 40 }), z: 'a1' },
  { ...rect('c', 'row', { x: 110, y: 10, width: 40, height: 40 }), z: 'a2' },
];
const START = { x: 210, y: 110, width: 40, height: 40, rotation: 0 };

function setup() {
  const store = createSelectStore(OBJECTS);
  const source = storeSource(store);
  let siblingReads = 0;
  const document = {
    get: (objectId: ObjectId) => source.get(objectId),
    childrenOf: (objectId: ObjectId) => {
      if (objectId === id('row')) siblingReads += 1;
      return source.childrenOf(objectId);
    },
  };
  const gesture = new SelectGesture({
    store,
    document,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(indexOf(OBJECTS), source),
  });
  return { store, gesture, source, siblingReads: () => siblingReads };
}

function changed(target: object): void {
  const method = Reflect.get(target, 'documentChanged') as (() => void) | undefined;
  expect(method).toBeTypeOf('function');
  method?.call(target);
}

describe('PR2 stack sibling acceptance', () => {
  it('keeps the document drawable gate when computing a cached stack slot', () => {
    const { source } = setup();
    const gated = { ...source, isDrawable: (objectId: ObjectId) => objectId !== id('b') };
    const moving = new Set([id('c')]);
    const point = { x: 175, y: 130 };
    expect(stackSlotOf(id('row'), moving, point, new DragDocument(gated))).toEqual(
      stackSlotOf(id('row'), moving, point, gated),
    );
  });

  it('reads each container’s siblings once across repeated crossings in a gesture', () => {
    const { gesture, siblingReads } = setup();
    const selection = selectionOf([id('c')]);
    gesture.update(move(-55, 0), selection, START);
    const first = siblingReads();
    expect(first).toBeGreaterThan(0);
    for (const x of [-105, -55, -105, -55]) gesture.update(move(x, 0), selection, START);
    expect(siblingReads()).toBe(first);
  });

  it('invalidates sibling order on documentChanged and matches the live slot after remote reorder', () => {
    const { store, gesture, source, siblingReads } = setup();
    const selection = selectionOf([id('c')]);
    gesture.update(move(-105, 0), selection, START);
    const before = siblingReads();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('b'), { z: 'a0' });
      transaction.patchObject(id('a'), { z: 'a1' });
    });
    changed(gesture);
    gesture.update(move(-105, 0), selection, START);
    const expected = stackSlotOf(id('row'), new Set([id('c')]), { x: 125, y: 130 }, source);
    expect(gesture.insertion).toEqual(expected?.line);
    expect(siblingReads()).toBeGreaterThan(before);
  });
});
