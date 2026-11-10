import { describe, expect, it } from 'vitest';

import { type BoardObject, type ObjectId, type PrincipalId } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { setAutoLayoutCommand } from '../commands/set-auto-layout.js';
import { setInstanceOverrideCommand } from '../commands/set-instance-override.js';
import { createHistory } from '../history/undo-manager.js';
import { exchange, fixtureObject } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { box, frame, rect, ROW, storeWith } from './__fixtures__/auto-layout-fixtures.js';

const ADA_ID = 'user:ada' as PrincipalId;

function rowStore(isNested = false): YjsDocumentStore {
  const base = fixtureObject('frame-plan', 'frame');
  const common = {
    x: base.x,
    y: base.y,
    rotation: base.rotation,
    z: base.z,
    locked: base.locked,
    createdBy: base.createdBy,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
  };
  const main = {
    ...common,
    id: 'main' as ObjectId,
    type: 'component' as const,
    pageId: 'page-1',
    parentId: null,
    width: 130,
    height: 30,
    name: 'Row',
    retired: false,
  } as BoardObject;
  const instance = {
    ...common,
    id: 'inst' as ObjectId,
    type: 'instance' as const,
    parentId: isNested ? ('stack' as ObjectId) : null,
    pageId: isNested ? null : 'page-1',
    mainId: 'main' as ObjectId,
    overrides: {},
    width: 130,
    height: 30,
    z: 'a0',
  } as BoardObject;
  const label = {
    ...fixtureObject('text-title', 'text'),
    id: 'label' as ObjectId,
    parentId: 'main' as ObjectId,
    pageId: null,
    x: 55,
    y: 5,
    width: 30,
    height: 20,
    z: 'a1',
    text: 'Hi',
    runs: [{ length: 2, style: fixtureObject('text-title', 'text').runs[0]?.style }],
  } as BoardObject;
  const store = storeWith(
    ...(isNested ? [frame('stack')] : []),
    main,
    box('first', 'main', 'a0', 40, 20),
    label,
    box('last', 'main', 'a2', 40, 20),
    instance,
    ...(isNested ? [box('after', 'stack', 'a1', 20, 20)] : []),
  );
  applyCommand(store, setAutoLayoutCommand, { ids: ['main'], autoLayout: ROW });
  if (isNested) applyCommand(store, setAutoLayoutCommand, { ids: ['stack'], autoLayout: ROW });
  return store;
}

describe('instance override reflow', () => {
  it('hiding a child resizes its instance in the same command and one undo step', () => {
    const store = rowStore();
    const history = createHistory(store, ADA_ID);
    applyCommand(store, setInstanceOverrideCommand, {
      id: 'inst',
      path: 'first',
      override: { isHidden: true },
    });
    expect(rect(store, 'inst').slice(2)).toEqual([90, 30]);
    expect(history.undo()).toBe(true);
    expect(rect(store, 'inst').slice(2)).toEqual([140, 30]);
    expect(history.canUndo()).toBe(false);
  });

  it('an overridden measured label resizes the instance and re-lays its parent stack', () => {
    const store = rowStore(true);
    expect(rect(store, 'after').slice(0, 2)).toEqual([155, 5]);
    applyCommand(store, setInstanceOverrideCommand, {
      id: 'inst',
      path: 'label',
      override: { text: 'Longer label', measuredSize: { width: 70, height: 24 } },
    });
    expect(rect(store, 'inst').slice(2)).toEqual([180, 34]);
    expect(rect(store, 'after').slice(0, 2)).toEqual([195, 5]);
    expect(rect(store, 'stack').slice(2)).toEqual([220, 44]);
  });

  it('a synced client gets the override-specific instance size', () => {
    const first = rowStore();
    const second = new YjsDocumentStore();
    exchange(first, second);
    applyCommand(first, setInstanceOverrideCommand, {
      id: 'inst',
      path: 'label',
      override: { text: 'Longer label', measuredSize: { width: 70, height: 24 } },
    });
    exchange(first, second);
    exchange(first, second);
    expect(rect(first, 'inst').slice(2)).toEqual([180, 34]);
    expect(rect(second, 'inst').slice(2)).toEqual([180, 34]);
    expect(first.encodeStateVector()).toEqual(second.encodeStateVector());
  });
});
