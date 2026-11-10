import { describe, expect, it } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ColorMode, ObjectId, PrincipalId } from '@canvas/schema';

import { DocumentHitIndex } from './document-hit-index.js';
import { documentHitTester } from './document-hit-tester.js';
import { connectorTargetUnder } from './document-tools.js';

/**
 * A 100 × 100 rectangle at the origin.
 *
 * @param id - Its id.
 * @param z - Its z key.
 * @param fill - Its fill.
 * @returns The object.
 */
function square(id: string, z: string, fill: unknown): BoardObject {
  return {
    id: id as ObjectId,
    parentId: null,
    rotation: 0,
    locked: false,
    createdBy: 'user:test',
    createdAt: 1,
    updatedAt: 1,
    x: 0,
    y: 0,
    z,
    type: 'shape',
    kind: 'rectangle',
    width: 100,
    height: 100,
    stroke: null,
    fill,
    cornerRadius: 0,
    sides: 4,
    label: null,
  } as BoardObject;
}

describe('documentHitTester', () => {
  it('picks a token fill by its value in the viewer theme, as drawn', () => {
    const store = new YjsDocumentStore({ clientId: 7 });
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setToken(
        { id: 'ghost', name: 'Ghost', light: [0, 0, 0, 0], dark: [0, 0, 1, 1] },
        { createdBy: 'user:test' as PrincipalId, createdAt: 1 },
      );
      transaction.setObject(square('below', 'a0', [1, 0, 0, 1]));
      transaction.setObject(square('ghost', 'a1', { token: 'ghost' }));
    });
    const hits = new DocumentHitIndex(store);
    const source = {
      get: (id: ObjectId) => hits.get(id),
      childrenOf: (id: ObjectId) => store.references.childrenOf(id),
      isDrawable: (id: ObjectId) => hits.isDrawable(id),
    };
    let theme: ColorMode = 'light';
    const creationInk = { theme: () => theme };
    const { hitTester, paletteOf } = documentHitTester(hits, source, store, { creationInk });
    const centre = { x: 50, y: 50 };
    expect(hitTester.hitPoint(centre, 1)?.id).toBe('below');
    expect(connectorTargetUnder(hits.index, source, centre, 1, paletteOf)).toBe('below');
    theme = 'dark';
    expect(hitTester.hitPoint(centre, 1)?.id).toBe('ghost');
    expect(connectorTargetUnder(hits.index, source, centre, 1, paletteOf)).toBe('ghost');
  });
});
