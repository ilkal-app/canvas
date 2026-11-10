// Acceptance: instance scale is an absolute command input and stored only off 1.
import { describe, expect, it } from 'vitest';

import { resolveInstance, type InstanceObject } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import { placeInstance, seedLeafMain } from './__fixtures__/component-boards.js';
import { createInstanceCommand } from './create-instance.js';
import { resizeObjectsCommand } from './resize-objects.js';

function seeded() {
  const store = new YjsDocumentStore();
  seedLeafMain(store, 'main', { x: 0, y: 0 });
  placeInstance(store, 'main', { instanceId: 'copy', x: 400, y: 300 });
  return store;
}

function instance(store: YjsDocumentStore): InstanceObject {
  const object = mustGet(store, 'copy');
  if (object.type !== 'instance') throw new Error('copy is not an instance');
  return object;
}

function scale(store: YjsDocumentStore, value: number, origin?: { x: number; y: number }) {
  return applyCommand(store, resizeObjectsCommand, {
    resizes: [{ id: 'copy', scale: value, ...(origin === undefined ? {} : { origin }) }],
  });
}

describe('document instance scale', () => {
  it('scales the drawn box by the absolute ratio, moves an optional origin, and resolves scaled content', () => {
    const store = seeded();
    expect(scale(store, 0.5, { x: 500, y: 350 }).result).toEqual({ resizedIds: ['copy'] });
    expect(instance(store)).toMatchObject({ x: 500, y: 350, width: 80, height: 80, scale: 0.5 });
    const leaf = resolveInstance(store.read(), instance(store)).objects[0];
    expect(leaf).toMatchObject({ width: 80, height: 80 });
    scale(store, 2);
    expect(instance(store)).toMatchObject({ width: 320, height: 320, scale: 2 });
  });

  it('removes scale at 1 and undoes and redoes each scale resize in one step', () => {
    const store = seeded();
    const history = createHistory(store, ADA.principalId);
    scale(store, 2);
    scale(store, 1);
    expect(instance(store).scale).toBeUndefined();
    expect(instance(store)).toMatchObject({ width: 160, height: 160 });
    expect(history.undo()).toBe(true);
    expect(instance(store)).toMatchObject({ width: 320, height: 320, scale: 2 });
    expect(history.undo()).toBe(true);
    expect(instance(store).scale).toBeUndefined();
    expect(instance(store)).toMatchObject({ width: 160, height: 160 });
    expect(history.canUndo()).toBe(false);
    expect(history.redo()).toBe(true);
    expect(instance(store)).toMatchObject({ width: 320, scale: 2 });
    history.destroy();
  });

  it('keeps content scale when a later to or by resize changes the box', () => {
    const store = seeded();
    scale(store, 0.5);
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'copy', to: { width: 120, height: 100 } }],
    });
    expect(instance(store)).toMatchObject({ scale: 0.5, width: 120, height: 100 });
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'copy', by: { width: 20, height: -10 } }],
    });
    expect(instance(store)).toMatchObject({ scale: 0.5, width: 140, height: 90 });
  });

  it('refuses scale on a non-instance with unsupported-type and refuses locked instances', () => {
    const store = seeded();
    expect(
      expectRejected(store, resizeObjectsCommand, {
        resizes: [{ id: 'main-leaf', scale: 2 }],
      }).map((error) => error.code),
    ).toEqual(['unsupported-type']);
    store.transact(ADA, (transaction) => {
      transaction.patchObject(instance(store).id, { locked: true });
    });
    expect(
      expectRejected(store, resizeObjectsCommand, {
        resizes: [{ id: 'copy', scale: 2 }],
      }).map((error) => error.code),
    ).toContain('locked');
  });

  it.each([0.049, 20.001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses out-of-range or non-finite scale %s as invalid-input',
    (value) => {
      const store = seeded();
      expect(
        expectRejected(store, resizeObjectsCommand, {
          resizes: [{ id: 'copy', scale: value }],
        }).map((error) => error.code),
      ).toContain('invalid-input');
    },
  );

  it('accepts both bounds on creation and defaults the drawn box to main size times scale', () => {
    const store = seeded();
    for (const [value, expected] of [
      [0.05, 8],
      [20, 3200],
    ] as const) {
      const { result } = applyCommand(store, createInstanceCommand, {
        componentId: 'main',
        instanceId: `bound-${String(expected)}`,
        x: 0,
        y: 0,
        scale: value,
      });
      expect(mustGet(store, result.instanceId)).toMatchObject({
        scale: value,
        width: expected,
        height: expected,
      });
    }
  });

  it('uses explicit width and height as the drawn box, and omits scale when it is 1', () => {
    const store = seeded();
    const sized = placeInstance(store, 'main', {
      instanceId: 'sized',
      scale: 0.5,
      width: 90,
      height: 70,
    });
    expect(mustGet(store, sized)).toMatchObject({ scale: 0.5, width: 90, height: 70 });
    const plain = placeInstance(store, 'main', { instanceId: 'plain', scale: 1 });
    expect(mustGet(store, plain)).toMatchObject({ scale: undefined });
  });

  it('defaults a hugging main to its laid size times scale', () => {
    const store = seeded();
    store.transact(ADA, (transaction) => {
      transaction.patchObject('main' as never, {
        autoLayout: {
          direction: 'row',
          gap: 0,
          padding: { top: 5, right: 5, bottom: 5, left: 5 },
          align: 'start',
          justify: 'start',
          width: 'hug',
          height: 'hug',
        },
      });
    });
    const created = placeInstance(store, 'main', { instanceId: 'hug', scale: 0.5 });
    const placed = mustGet(store, created);
    expect(placed).toMatchObject({ width: 85, height: 85, scale: 0.5 });
  });

  it('keeps an explicit drawn box when creating a scaled instance of a hugging main', () => {
    const store = seeded();
    store.transact(ADA, (transaction) => {
      transaction.patchObject('main' as never, {
        autoLayout: {
          direction: 'row',
          gap: 0,
          padding: { top: 5, right: 5, bottom: 5, left: 5 },
          align: 'start',
          justify: 'start',
          width: 'hug',
          height: 'hug',
        },
      });
    });
    const created = placeInstance(store, 'main', {
      instanceId: 'explicit-hug',
      scale: 0.5,
      width: 90,
      height: 70,
    });
    expect(mustGet(store, created)).toMatchObject({ width: 90, height: 70, scale: 0.5 });
  });

  it.each([0.049, 20.001, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses createInstance scale %s as invalid-input',
    (value) => {
      const store = seeded();
      expect(
        expectRejected(store, createInstanceCommand, {
          componentId: 'main',
          x: 0,
          y: 0,
          scale: value,
        }).map((error) => error.code),
      ).toContain('invalid-input');
    },
  );
});
