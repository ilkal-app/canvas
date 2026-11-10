import { describe, expect, it } from 'vitest';

import { type AutoLayout, type BoardObject, type ObjectId, type PrincipalId } from '@canvas/schema';

import {
  applyCommand,
  expectRejected,
  mustGet,
} from '../commands/__fixtures__/command-fixtures.js';
import { detachInstanceCommand } from '../commands/detach-instance.js';
import { previewCommand } from '../commands/preview-command.js';
import { resizeObjectsCommand } from '../commands/resize-objects.js';
import { setAutoLayoutCommand, setLayoutChildCommand } from '../commands/set-auto-layout.js';
import { createHistory } from '../history/undo-manager.js';
import { ADA, exchange, fixtureObject } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import {
  box,
  frame,
  rect,
  ROW,
  storeWith,
  storeWithComponents,
} from './__fixtures__/auto-layout-fixtures.js';

// A frame's or main's live auto-layout, laid out by the command that changes it and
// by every later command that changes its children, in the same transaction.

const ADA_ID = 'user:ada' as PrincipalId;

describe('setAutoLayout', () => {
  it('lays a row out in stacking order and hugs it, in one undo step', () => {
    const store = storeWith(
      frame('f'),
      box('b', 'f', 'a1', 30, 20),
      box('a', 'f', 'a0', 40, 10),
      box('c', 'f', 'a2', 50, 30),
    );
    const history = createHistory(store, ADA_ID);
    const { result } = applyCommand(store, setAutoLayoutCommand, { ids: ['f'], autoLayout: ROW });
    expect(result.updatedIds).toEqual(['f']);
    expect(rect(store, 'a')).toEqual([5, 5, 40, 10]);
    expect(rect(store, 'b')).toEqual([55, 5, 30, 20]);
    expect(rect(store, 'c')).toEqual([95, 5, 50, 30]);
    expect(rect(store, 'f')).toEqual([100, 100, 150, 40]);
    expect(history.undo()).toBe(true);
    expect(rect(store, 'f')).toEqual([100, 100, 400, 300]);
    expect(rect(store, 'b')).toEqual([0, 0, 30, 20]);
    expect(history.canUndo()).toBe(false);
  });

  it('shares the free main axis among filling children of a fixed column', () => {
    const column: AutoLayout = { ...ROW, direction: 'column', width: 'fixed', height: 'fixed' };
    const store = storeWith(frame('f'), box('a', 'f', 'a0', 40, 10), box('b', 'f', 'a1', 40, 10));
    applyCommand(store, setLayoutChildCommand, { ids: ['b'], layoutChild: { fill: true } });
    applyCommand(store, setAutoLayoutCommand, { ids: ['f'], autoLayout: column });
    expect(rect(store, 'a')).toEqual([5, 5, 40, 10]);
    expect(rect(store, 'b')).toEqual([5, 25, 40, 270]);
    expect(rect(store, 'f')).toEqual([100, 100, 400, 300]);
  });

  it('re-lays the row when a child is resized, and the parent stack when the row hugs', () => {
    const store = storeWith(
      frame('outer'),
      frame('row', 'outer', 'a0'),
      box('a', 'row', 'a0', 40, 10),
      box('b', 'row', 'a1', 30, 20),
      box('after', 'outer', 'a1', 20, 20),
    );
    applyCommand(store, setAutoLayoutCommand, {
      ids: ['outer'],
      autoLayout: {
        ...ROW,
        direction: 'column',
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    });
    applyCommand(store, setAutoLayoutCommand, { ids: ['row'], autoLayout: ROW });
    expect(rect(store, 'row')).toEqual([0, 0, 90, 30]);
    expect(rect(store, 'after')).toEqual([0, 40, 20, 20]);
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'a', to: { width: 40, height: 60 } }],
    });
    expect(rect(store, 'row')).toEqual([0, 0, 90, 70]);
    expect(rect(store, 'after')).toEqual([0, 80, 20, 20]);
  });

  it('previews the layout it would write, as running it writes', () => {
    const store = storeWith(frame('f'), box('a', 'f', 'a0', 40, 10), box('b', 'f', 'a1', 30, 20));
    const environment = { clock: () => 1_760_000_000_000, createId: () => 'unused' as ObjectId };
    const preview = previewCommand(
      store,
      ADA,
      setAutoLayoutCommand,
      { ids: ['f'], autoLayout: ROW },
      environment,
    );
    if (preview.status !== 'planned') throw new Error('the preview was refused');
    // The bound is judged on what a command writes; the relayout is part of it.
    expect([...preview.written.keys()].sort()).toEqual(['a', 'b', 'f']);
    applyCommand(store, setAutoLayoutCommand, { ids: ['f'], autoLayout: ROW });
    for (const [id, object] of preview.written) {
      const [x, y, width, height] = rect(store, id);
      expect(object).toMatchObject({ x, y, width, height });
    }
  });

  it('leaves the children where they are when the layout is removed', () => {
    const store = storeWith(frame('f'), box('a', 'f', 'a0', 40, 10), box('b', 'f', 'a1', 30, 20));
    applyCommand(store, setAutoLayoutCommand, { ids: ['f'], autoLayout: ROW });
    applyCommand(store, setAutoLayoutCommand, { ids: ['f'], autoLayout: null });
    expect((store.get('f' as ObjectId) as { autoLayout?: unknown }).autoLayout).toBeUndefined();
    expect(rect(store, 'b')).toEqual([55, 5, 30, 20]);
  });

  it('refuses a type that takes no auto-layout or layoutChild, writing nothing', () => {
    const store = storeWith(frame('f'), box('a', 'f', 'a0', 40, 10));
    expect(
      expectRejected(store, setAutoLayoutCommand, { ids: ['a'], autoLayout: ROW }).map(
        ({ code }) => code,
      ),
    ).toEqual(['unsupported-type']);
    const path = { ...fixtureObject('path-squiggle', 'path'), parentId: 'f', pageId: null };
    store.transact(ADA, (transaction) => {
      transaction.setObject(path as BoardObject);
    });
    expect(
      expectRejected(store, setLayoutChildCommand, {
        ids: [path.id],
        layoutChild: { fill: true },
      }).map(({ code }) => code),
    ).toEqual(['unsupported-type']);
  });
});

describe('auto-layout across clients, instances, resizes and detach', () => {
  it('converges two clients that edit a laid-out row at once', () => {
    const first = storeWith(frame('f'), box('a', 'f', 'a0', 40, 10), box('b', 'f', 'a1', 30, 20));
    applyCommand(first, setAutoLayoutCommand, { ids: ['f'], autoLayout: ROW });
    const second = new YjsDocumentStore();
    exchange(first, second);
    applyCommand(first, resizeObjectsCommand, {
      resizes: [{ id: 'a', to: { width: 80, height: 10 } }],
    });
    applyCommand(second, setAutoLayoutCommand, { ids: ['f'], autoLayout: { ...ROW, gap: 20 } });
    exchange(first, second);
    exchange(first, second);
    for (const store of [first, second]) {
      expect(rect(store, 'a')).toEqual([5, 5, 80, 10]);
      expect(rect(store, 'b')).toEqual([105, 5, 30, 20]);
      expect(rect(store, 'f')).toEqual([100, 100, 140, 30]);
    }
    expect(first.encodeStateVector()).toEqual(second.encodeStateVector());
  });

  it('gives a hugging main its size on its instances, except on an axis an instance fixed', () => {
    const store = storeWithComponents();
    const main = store.get('component-card' as ObjectId) as { width: number; height: number };
    applyCommand(store, setAutoLayoutCommand, { ids: ['component-card'], autoLayout: ROW });
    const laid = rect(store, 'component-card');
    expect(laid.slice(2)).not.toEqual([main.width, main.height]);
    expect(rect(store, 'instance-card').slice(2)).toEqual(laid.slice(2));
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'instance-card', to: { width: 500, height: laid[3] ?? 0 } }],
    });
    expect(store.get('instance-card' as ObjectId)).toMatchObject({ isWidthFixed: true });
    applyCommand(store, setAutoLayoutCommand, {
      ids: ['component-card'],
      autoLayout: { ...ROW, padding: { top: 25, right: 25, bottom: 25, left: 25 } },
    });
    const relaid = rect(store, 'component-card');
    expect(rect(store, 'instance-card').slice(2)).toEqual([500, relaid[3]]);
  });

  it('re-lays a stack holding an instance when its hugging main resizes it', () => {
    const store = storeWithComponents();
    const instance = mustGet(store, 'instance-card');
    store.transact(ADA, (transaction) => {
      transaction.setObject(frame('stack'));
      transaction.setObject({ ...instance, parentId: 'stack' as ObjectId, pageId: null, z: 'a0' });
      transaction.setObject(box('after', 'stack', 'a1', 30, 20));
    });
    applyCommand(store, setAutoLayoutCommand, { ids: ['stack'], autoLayout: ROW });
    applyCommand(store, setAutoLayoutCommand, { ids: ['component-card'], autoLayout: ROW });
    const [, , width = 0, height = 0] = rect(store, 'instance-card');
    expect([width, height]).toEqual(rect(store, 'component-card').slice(2));
    // The sibling follows the instance's new width, and the hugging stack takes the new content.
    expect(rect(store, 'after').slice(0, 2)).toEqual([5 + width + 10, 5]);
    expect(rect(store, 'stack').slice(2)).toEqual([
      5 + width + 10 + 30 + 5,
      5 + Math.max(height, 20) + 5,
    ]);
  });

  it('re-lays a stack in the repair pass when a peer writes a child without the command layer', () => {
    const first = storeWith(frame('f'), box('a', 'f', 'a0', 40, 10), box('b', 'f', 'a1', 30, 20));
    applyCommand(first, setAutoLayoutCommand, { ids: ['f'], autoLayout: ROW });
    const second = new YjsDocumentStore();
    exchange(first, second);
    // A raw write, as a peer that bypasses the command layer would send: no relayout with it.
    second.transact(ADA, (transaction) => {
      transaction.setObject({ ...mustGet(second, 'a'), width: 80 } as BoardObject);
    });
    expect(rect(second, 'b')).toEqual([55, 5, 30, 20]);
    exchange(first, second);
    exchange(first, second);
    for (const store of [first, second]) {
      expect(rect(store, 'b')).toEqual([95, 5, 30, 20]);
      expect(rect(store, 'f')).toEqual([100, 100, 130, 30]);
    }
    expect(first.encodeStateVector()).toEqual(second.encodeStateVector());
  });

  it('stretches an instance across a row while its hugging main sets its width, and settles', () => {
    const store = storeWithComponents();
    const instance = mustGet(store, 'instance-card');
    store.transact(ADA, (transaction) => {
      transaction.setObject(frame('stack'));
      transaction.setObject({ ...instance, parentId: 'stack' as ObjectId, pageId: null, z: 'a0' });
    });
    const stretchRow: AutoLayout = { ...ROW, align: 'stretch', height: 'fixed' };
    applyCommand(store, setAutoLayoutCommand, { ids: ['stack'], autoLayout: stretchRow });
    applyCommand(store, setAutoLayoutCommand, { ids: ['component-card'], autoLayout: ROW });
    const [, , mainWidth] = rect(store, 'component-card');
    // The main gives the instance its width; the stretching row gives it the row's inner height.
    expect(rect(store, 'instance-card')).toEqual([5, 5, mainWidth, 300 - 5 - 5]);
    const before = store.encodeStateVector();
    applyCommand(store, setAutoLayoutCommand, { ids: ['stack'], autoLayout: stretchRow });
    expect(store.encodeStateVector()).toEqual(before);
  });

  it('fixes the axis a resize changes on a hugging container', () => {
    const store = storeWith(frame('f'), box('a', 'f', 'a0', 40, 10));
    applyCommand(store, setAutoLayoutCommand, { ids: ['f'], autoLayout: ROW });
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'f', to: { width: 300, height: 20 } }],
    });
    expect(store.get('f' as ObjectId)).toMatchObject({
      autoLayout: { width: 'fixed', height: 'hug' },
    });
    expect(rect(store, 'f')).toEqual([100, 100, 300, 20]);
    expect(rect(store, 'a')).toEqual([5, 5, 40, 10]);
  });

  it('gives a frame made from an instance its main’s auto-layout', () => {
    const store = storeWithComponents();
    applyCommand(store, setAutoLayoutCommand, { ids: ['component-card'], autoLayout: ROW });
    applyCommand(store, detachInstanceCommand, { id: 'instance-card' });
    expect(store.get('instance-card' as ObjectId)).toMatchObject({
      type: 'frame',
      autoLayout: ROW,
    });
  });
});
