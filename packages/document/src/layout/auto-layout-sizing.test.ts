import { describe, expect, it } from 'vitest';

import { MAX_DRAWABLE_SIZE, validateBoard, type BoardObject, type ObjectId } from '@canvas/schema';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { detachInstanceCommand } from '../commands/detach-instance.js';
import { relayoutOf } from '../commands/preview-command.js';
import { resizeObjectsCommand } from '../commands/resize-objects.js';
import { setAutoLayoutCommand, setLayoutChildCommand } from '../commands/set-auto-layout.js';
import { ADA, exchange } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import {
  box,
  frame,
  rect,
  ROW,
  storeWith,
  storeWithComponents,
} from './__fixtures__/auto-layout-fixtures.js';

// Which axes a resize fixes, what a detached instance keeps, removing a layoutChild,
// and a hugging main's instances followed in the repair pass.

describe('auto-layout sizing, detach and repair', () => {
  it('keeps a hugging container hugging when a resize leaves its size as laid', () => {
    const store = storeWith(frame('f'), box('a', 'f', 'a0', 40, 10));
    applyCommand(store, setAutoLayoutCommand, { ids: ['f'], autoLayout: ROW });
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'f', to: { width: 50, height: 20 } }],
    });
    expect(store.get('f' as ObjectId)).toMatchObject({ autoLayout: ROW });
  });

  it('fixes only the height when a resize changes only the height of a hugging container', () => {
    const store = storeWith(frame('f'), box('a', 'f', 'a0', 40, 10));
    applyCommand(store, setAutoLayoutCommand, { ids: ['f'], autoLayout: ROW });
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'f', to: { width: 50, height: 90 } }],
    });
    expect(store.get('f' as ObjectId)).toMatchObject({
      autoLayout: { width: 'hug', height: 'fixed' },
    });
  });

  it('fixes an instance’s axis a resize changes only where its main hugs', () => {
    const store = storeWithComponents();
    const before = rect(store, 'instance-card');
    // The main has no auto-layout yet: a resize sets no fixed flag.
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'instance-card', to: { width: before[2] ?? 0, height: 333 } }],
    });
    expect(mustGet(store, 'instance-card')).toHaveProperty('type', 'instance');
    expect(
      (mustGet(store, 'instance-card') as { isHeightFixed?: boolean }).isHeightFixed,
    ).toBeUndefined();
    applyCommand(store, setAutoLayoutCommand, { ids: ['component-card'], autoLayout: ROW });
    const laid = rect(store, 'instance-card');
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'instance-card', to: { width: laid[2] ?? 0, height: 444 } }],
    });
    expect(store.get('instance-card' as ObjectId)).toMatchObject({ isHeightFixed: true });
    expect(
      (mustGet(store, 'instance-card') as { isWidthFixed?: boolean }).isWidthFixed,
    ).toBeUndefined();
  });

  it('gives a frame made from an instance the axes the instance fixed, as fixed', () => {
    const store = storeWithComponents();
    applyCommand(store, setAutoLayoutCommand, { ids: ['component-card'], autoLayout: ROW });
    const instance = mustGet(store, 'instance-card');
    store.transact(ADA, (transaction) => {
      transaction.setObject({
        ...instance,
        isWidthFixed: true,
        isHeightFixed: true,
      } as BoardObject);
    });
    applyCommand(store, detachInstanceCommand, { id: 'instance-card' });
    expect(store.get('instance-card' as ObjectId)).toMatchObject({
      type: 'frame',
      autoLayout: { ...ROW, width: 'fixed', height: 'fixed' },
    });
  });

  it('makes a frame without auto-layout from an instance whose main has none', () => {
    const store = storeWithComponents();
    applyCommand(store, detachInstanceCommand, { id: 'instance-card' });
    expect(store.get('instance-card' as ObjectId)).toMatchObject({
      type: 'frame',
      autoLayout: undefined,
    });
  });

  it('removes a box’s layoutChild', () => {
    const store = storeWith(frame('f'), box('a', 'f', 'a0', 40, 10));
    applyCommand(store, setLayoutChildCommand, { ids: ['a'], layoutChild: { fill: true } });
    applyCommand(store, setLayoutChildCommand, { ids: ['a'], layoutChild: null });
    expect((mustGet(store, 'a') as { layoutChild?: unknown }).layoutChild).toBeUndefined();
  });

  it('resizes a hugging main’s instances in the repair pass after a peer’s raw write', () => {
    const first = storeWithComponents();
    first.transact(ADA, (transaction) => {
      transaction.setObject(box('card-child', 'component-card', 'a0', 40, 10));
    });
    applyCommand(first, setAutoLayoutCommand, { ids: ['component-card'], autoLayout: ROW });
    const second = new YjsDocumentStore();
    exchange(first, second);
    second.transact(ADA, (transaction) => {
      transaction.setObject({ ...mustGet(second, 'card-child'), width: 140 } as BoardObject);
    });
    exchange(first, second);
    exchange(first, second);
    for (const store of [first, second]) {
      expect(rect(store, 'component-card').slice(2)).toEqual([150, 20]);
      expect(rect(store, 'instance-card').slice(2)).toEqual([150, 20]);
    }
    expect(first.encodeStateVector()).toEqual(second.encodeStateVector());
  });

  it('keeps a hugging container in place when a peer’s raw write would carry it past the extent', () => {
    const first = storeWith(frame('f'), box('a', 'f', 'a0', 40, 10), box('b', 'f', 'a1', 30, 20));
    applyCommand(first, setAutoLayoutCommand, {
      ids: ['f'],
      autoLayout: { ...ROW, direction: 'column' },
    });
    const second = new YjsDocumentStore();
    exchange(first, second);
    const laid = rect(first, 'f');
    // Each child alone is drawable; stacked, the hugging column would not be.
    second.transact(ADA, (transaction) => {
      for (const id of ['a', 'b']) {
        transaction.setObject({ ...mustGet(second, id), height: MAX_DRAWABLE_SIZE } as BoardObject);
      }
    });
    expect(() => {
      exchange(first, second);
      exchange(first, second);
    }).not.toThrow();
    for (const store of [first, second]) {
      expect(rect(store, 'f')).toEqual(laid);
      expect(validateBoard(store.read())).toEqual([]);
    }
  });

  it('plans no write the store would refuse: a hostile column past the extent keeps its size', () => {
    const store = storeWith(frame('f'), box('a', 'f', 'a0', 40, 10), box('b', 'f', 'a1', 30, 20));
    applyCommand(store, setAutoLayoutCommand, {
      ids: ['f'],
      autoLayout: { ...ROW, direction: 'column' },
    });
    // A peer's raw writes: each child drawable alone, the hugging column not.
    store.transact(ADA, (transaction) => {
      for (const id of ['a', 'b']) {
        transaction.setObject({ ...mustGet(store, id), height: MAX_DRAWABLE_SIZE } as BoardObject);
      }
    });
    const a = mustGet(store, 'a');
    const planned = relayoutOf(store, new Map([[a.id, { ...a, width: 60 } as BoardObject]]));
    expect(planned.has('f' as ObjectId)).toBe(false);
    expect(planned.size).toBeGreaterThan(0);
  });
});
