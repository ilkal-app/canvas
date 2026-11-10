// Independent Red-lane acceptance: createObjects resolves instance override names.
import { describe, expect, it } from 'vitest';

import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import { createChild, newFrame, newRectangle, newText } from './__fixtures__/component-boards.js';
import { codesOf, mustFindCommand, overridesOf } from './__fixtures__/component-fixtures.js';
import { createObjectsCommand } from './create-objects.js';

const GREEN: [number, number, number, number] = [0, 1, 0, 1];
const BLUE: [number, number, number, number] = [0, 0, 1, 1];

function instance(mainId: string, overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'instance',
    id: 'copy',
    parentId: null,
    mainId,
    x: 600,
    y: 0,
    width: 400,
    height: 300,
    overrides,
  };
}

function namedMain(): YjsDocumentStore {
  const store = new YjsDocumentStore();
  const title = createChild(
    store,
    newText('title-id', null, { x: 0, y: 0, width: 120, height: 40 }),
  );
  const box = createChild(
    store,
    newRectangle('box-id', null, { x: 150, y: 0, width: 80, height: 80 }),
  );
  const body = createChild(
    store,
    newFrame('body-id', null, { x: 0, y: 100, width: 200, height: 100 }),
  );
  const label = createChild(
    store,
    newText('label-id', body, { x: 0, y: 0, width: 100, height: 40 }),
  );
  const rename = mustFindCommand('renameObject');
  for (const [id, name] of [
    [title, 'Title'],
    [box, 'Box'],
    [body, 'Body'],
    [label, 'Label'],
  ]) {
    applyCommand(store, rename, { id, name });
  }
  applyCommand(store, mustFindCommand('createComponent'), {
    ids: [title, box, body],
    name: 'Card',
    componentId: 'card-main',
  });
  return store;
}

function sameCallEntries(): Record<string, unknown>[] {
  return [
    {
      type: 'component',
      id: 'card',
      parentId: null,
      name: 'Card',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      retired: false,
    },
    { ...newText('title', 'card', { x: 0, y: 0, width: 120, height: 40 }), name: 'Title' },
    { ...newRectangle('box', 'card', { x: 150, y: 0, width: 80, height: 80 }), name: 'Box' },
    { ...newFrame('body', 'card', { x: 0, y: 100, width: 200, height: 100 }), name: 'Body' },
    { ...newText('label', 'body', { x: 0, y: 0, width: 100, height: 40 }), name: 'Label' },
    instance('card', {
      Title: { text: 'Changed' },
      'Body/Label': { opacity: 0.4 },
      box: { fill: BLUE },
    }),
  ];
}

describe('createObjects instance override name paths', () => {
  it('stores name paths and an id path under source ids for an existing main', () => {
    const store = namedMain();
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: [
        instance('card-main', {
          Title: { text: 'Changed' },
          'Body/Label': { opacity: 0.4 },
          'box-id': { fill: BLUE },
        }),
      ] as never,
    });
    expect(overridesOf(store, result.ids[0] ?? '')).toEqual({
      'title-id': { text: 'Changed' },
      'label-id': { opacity: 0.4 },
      'box-id': { fill: BLUE },
    });
    store.destroy();
  });

  it('resolves names against a main and children created earlier in the same call', () => {
    const store = new YjsDocumentStore();
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: sameCallEntries() as never,
    });
    const [, titleId, boxId, , labelId, copyId] = result.ids;
    expect(overridesOf(store, copyId ?? '')).toEqual({
      [titleId ?? '']: { text: 'Changed' },
      [labelId ?? '']: { opacity: 0.4 },
      [boxId ?? '']: { fill: BLUE },
    });
    store.destroy();
  });

  it('merges two keys resolving to one child in input order', () => {
    const store = namedMain();
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: [
        instance('card-main', {
          Title: { text: 'First', opacity: 0.4 },
          'title-id': { text: 'Second' },
        }),
      ] as never,
    });
    expect(overridesOf(store, result.ids[0] ?? '')).toEqual({
      'title-id': { text: 'Second', opacity: 0.4 },
    });
    store.destroy();
  });

  it('refuses an unknown name at its key and writes nothing', () => {
    const store = namedMain();
    const errors = expectRejected(store, createObjectsCommand, {
      objects: [instance('card-main', { Nope: { text: 'Changed' } })],
    });
    expect(codesOf(errors)).toEqual(['invalid-override-path']);
    expect(errors[0]?.path).toEqual(['objects', 0, 'overrides', 'Nope']);
    store.destroy();
  });

  it('refuses a shared name as ambiguous at its key and writes nothing', () => {
    const store = namedMain();
    createChild(store, {
      ...newRectangle('twin-a', 'card-main', { x: 0, y: 250, width: 20, height: 20 }),
      name: 'Twin',
    });
    createChild(store, {
      ...newRectangle('twin-b', 'card-main', { x: 30, y: 250, width: 20, height: 20 }),
      name: 'Twin',
    });
    expect(mustGet(store, 'twin-a').name).toBe('Twin');
    const errors = expectRejected(store, createObjectsCommand, {
      objects: [instance('card-main', { Twin: { fill: GREEN } })],
    });
    expect(codesOf(errors)).toEqual(['ambiguous-override-path']);
    expect(errors[0]?.path).toEqual(['objects', 0, 'overrides', 'Twin']);
    store.destroy();
  });
});
