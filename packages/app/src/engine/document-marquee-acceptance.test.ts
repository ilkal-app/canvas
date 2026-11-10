import { describe, expect, it } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId, Point } from '@canvas/schema';
import { createSelectHitTester, SelectController } from '@canvas/tools';

import { DocumentHitIndex } from './document-hit-index.js';

function shape(name: string, x: number): BoardObject {
  return {
    id: name as ObjectId,
    type: 'shape',
    kind: 'rectangle',
    parentId: null,
    x,
    y: 20,
    width: 20,
    height: 20,
    rotation: 0,
    z: `a${name}`,
    locked: false,
    stroke: null,
    fill: [1, 0, 0, 1],
    cornerRadius: 0,
    sides: 4,
    label: null,
    createdBy: 'user:test',
    createdAt: 1,
    updatedAt: 1,
  } as BoardObject;
}

describe('marquee with the app hit index (PR3)', () => {
  it('drops and restores a preview-hidden object on the next move', () => {
    const store = new YjsDocumentStore();
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject(shape('a', 20));
      transaction.setObject(shape('b', 60));
    });
    const hits = new DocumentHitIndex(store);
    const source = {
      get: (key: ObjectId) => hits.get(key),
      childrenOf: (key: ObjectId) => store.references.childrenOf(key),
    };
    const controller = new SelectController({
      store,
      origin: SYSTEM_ORIGIN,
      environment: {
        clock: () => 1,
        createId: () => {
          throw new Error('no creation');
        },
      },
      hitTester: createSelectHitTester(hits.index, source),
    });
    const at = (kind: 'pointerDown' | 'pointerMove', world: Point) => {
      controller.handle(
        { kind, world, screen: world, isShiftPressed: false, isModPressed: false },
        1,
      );
    };
    at('pointerDown', { x: 0, y: 0 });
    at('pointerMove', { x: 100, y: 100 });
    expect([...controller.selection.ids].sort()).toEqual(['a', 'b']);
    hits.setPreviewHidden(new Set(['b' as ObjectId]));
    at('pointerMove', { x: 101, y: 101 });
    expect(controller.selection.ids).toEqual(['a']);
    hits.setPreviewHidden(new Set());
    at('pointerMove', { x: 102, y: 102 });
    expect([...controller.selection.ids].sort()).toEqual(['a', 'b']);
    controller.destroy();
    hits.destroy();
  });
});
