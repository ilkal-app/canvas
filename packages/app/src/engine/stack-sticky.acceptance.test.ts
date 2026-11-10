// Shift+N stacks one sticky through the real document and selection controller.
import { describe, expect, it } from 'vitest';

import { createHistory, SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { ObjectId, PrincipalId, ShapeObject, StickyObject } from '@canvas/schema';
import { createSelectHitTester, SelectController } from '@canvas/tools';

import { LOCAL_USER_ORIGIN } from './demo-document.js';
import { DocumentHitIndex } from './document-hit-index.js';
import { stackSticky, stackedStickyOf } from './stack-sticky.js';

const above: StickyObject = {
  id: 'above' as ObjectId,
  type: 'sticky',
  parentId: null,
  x: 80,
  y: 90,
  z: 'a0',
  rotation: 0,
  locked: false,
  createdBy: 'user:test' as PrincipalId,
  createdAt: 1,
  updatedAt: 1,
  width: 400,
  height: 200,
  aspect: 'wide',
  text: 'Before',
  runs: [
    {
      length: 6,
      style: {
        fontFamily: 'Inter',
        fontSize: 16,
        color: 'ink',
        weight: 400,
        italic: false,
      },
    },
  ],
  align: 'center',
  autoWidth: false,
  verticalAlign: 'middle',
  color: [1, 0.74, 0.8, 1],
};

function setUp() {
  const store = new YjsDocumentStore();
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    transaction.setObject(above);
  });
  const hits = new DocumentHitIndex(store);
  const source = {
    get: (id: ObjectId) => hits.get(id),
    childrenOf: (id: ObjectId) => store.references.childrenOf(id),
  };
  const environment = { clock: () => 2, createId: () => 'below' as ObjectId };
  const controller = new SelectController({
    store,
    origin: LOCAL_USER_ORIGIN,
    environment,
    hitTester: createSelectHitTester(hits.index, source),
  });
  const history = createHistory(store, LOCAL_USER_ORIGIN.principalId);
  const context = { store, controller, origin: LOCAL_USER_ORIGIN, environment };
  return {
    store,
    controller,
    history,
    context,
    destroy: () => {
      controller.destroy();
      hits.destroy();
    },
  };
}

describe('stackSticky', () => {
  it('creates an empty matching note below the selected sticky and one undo removes it', () => {
    const { store, controller, history, context, destroy } = setUp();
    controller.select([above.id]);
    expect(stackSticky(context, 1)).toBe(true);
    expect(store.get('below' as ObjectId)).toMatchObject(stackedStickyOf(above));
    expect(controller.selection.ids).toEqual(['below']);
    expect(history.undo()).toBe(true);
    expect(store.get('below' as ObjectId)).toBeUndefined();
    expect(store.get(above.id)).toMatchObject(above);
    destroy();
  });

  it('does not write with no selection or more than one selected object', () => {
    const { store, controller, context, destroy } = setUp();
    expect(stackSticky(context, 1)).toBe(true);
    expect(store.get('below' as ObjectId)).toBeUndefined();
    controller.select([above.id, 'another' as ObjectId]);
    expect(stackSticky(context, 1)).toBe(true);
    expect(store.get('below' as ObjectId)).toBeUndefined();
    destroy();
  });

  it('does not stack when the only selected object is a shape', () => {
    const { store, controller, context, destroy } = setUp();
    const shape: ShapeObject = {
      id: 'shape' as ObjectId,
      type: 'shape',
      kind: 'rectangle',
      parentId: null,
      x: 10,
      y: 10,
      z: 'a1',
      rotation: 0,
      locked: false,
      createdBy: 'user:test' as PrincipalId,
      createdAt: 1,
      updatedAt: 1,
      width: 50,
      height: 50,
      stroke: null,
      fill: [1, 0, 0, 1],
      cornerRadius: 0,
      sides: 4,
      label: null,
    };
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject(shape);
    });
    controller.select([shape.id]);
    expect(stackSticky(context, 1)).toBe(true);
    expect(store.get('below' as ObjectId)).toBeUndefined();
    expect(controller.selection.ids).toEqual([shape.id]);
    destroy();
  });
});
