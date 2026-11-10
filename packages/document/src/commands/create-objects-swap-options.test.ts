import { describe, expect, it } from 'vitest';

import type { InstanceObject } from '@canvas/schema';

import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import { newFrame, newRectangle, seedLeafMain } from './__fixtures__/component-boards.js';
import { codesOf } from './__fixtures__/component-fixtures.js';
import { createObjectsCommand } from './create-objects.js';

const BOX = { x: 0, y: 0, width: 40, height: 40 };

function main(id: string, x: number): Record<string, unknown> {
  return {
    type: 'component',
    id,
    parentId: null,
    name: id,
    x,
    y: 0,
    width: 40,
    height: 40,
    retired: false,
  };
}

/**
 * A copied component definition, as a paste lists it: two icon mains, a button main whose slot
 * allows both, and an instance of the button swapping the slot to the second icon.
 *
 * @param swapTo - The listed main the instance swaps the slot to.
 * @returns The listed objects.
 */
function copiedDefinition(swapTo: string): Record<string, unknown>[] {
  return [
    main('icon-a', 400),
    newRectangle('icon-a-leaf', 'icon-a', BOX),
    main('icon-b', 500),
    newRectangle('icon-b-leaf', 'icon-b', BOX),
    main('button', 0),
    {
      type: 'instance',
      id: 'slot',
      parentId: 'button',
      mainId: 'icon-a',
      swapOptions: ['icon-a', 'icon-b'],
      ...BOX,
      overrides: {},
    },
    {
      type: 'instance',
      id: 'copy',
      parentId: null,
      mainId: 'button',
      x: 0,
      y: 200,
      width: 40,
      height: 40,
      overrides: { slot: { mainId: swapTo } },
    },
  ];
}

describe('createObjects copies a slot’s swap options with its mains', () => {
  it('pastes a definition whose instance swaps a copied slot to a copied option', () => {
    const store = new YjsDocumentStore();
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: copiedDefinition('icon-b'),
    } as never);
    const [iconA, , iconB, , , slotId, copyId] = result.ids;
    const slot = mustGet(store, slotId ?? '') as InstanceObject;
    expect(slot.swapOptions).toEqual([iconA, iconB]);
    const copy = mustGet(store, copyId ?? '') as InstanceObject;
    expect(copy.overrides).toEqual({ [slotId ?? '']: { mainId: iconB } });
    store.destroy();
  });

  it('keeps an option that names a main on the board, and still refuses one not listed', () => {
    const store = new YjsDocumentStore();
    seedLeafMain(store, 'stored', { x: 800, y: 0 });
    const stored = 'stored';
    const objects = copiedDefinition('icon-b');
    const slot = objects[5] ?? {};
    objects[5] = { ...slot, swapOptions: ['icon-a', stored] };
    const errors = expectRejected(store, createObjectsCommand, { objects });
    expect(codesOf(errors)).toEqual(['invalid-override']);
    expect(errors[0]?.path).toEqual(['objects', 6, 'overrides', expect.any(String), 'mainId']);
    objects[6] = { ...(objects[6] ?? {}), overrides: { slot: { mainId: stored } } };
    const pasted = applyCommand(store, createObjectsCommand, { objects } as never);
    const slotId = pasted.result.ids[5] ?? '';
    expect((mustGet(store, slotId) as InstanceObject).swapOptions?.[1]).toBe(stored);
    store.destroy();
  });
});

describe('createObjects reads only what an override walk can reach', () => {
  it('checks instances in a created frame and in a created main against the same rules', () => {
    const store = new YjsDocumentStore();
    const objects = [
      ...copiedDefinition('icon-b').slice(0, 6),
      newFrame('frame', null, { x: 0, y: 300, width: 200, height: 200 }),
      {
        type: 'instance',
        id: 'framed',
        parentId: 'frame',
        mainId: 'button',
        ...BOX,
        overrides: { slot: { mainId: 'icon-b' } },
      },
      {
        type: 'instance',
        id: 'nested',
        parentId: 'icon-b',
        mainId: 'icon-a',
        ...BOX,
        overrides: { 'icon-a-leaf': { opacity: 0.5 } },
      },
    ];
    const { result } = applyCommand(store, createObjectsCommand, { objects } as never);
    expect(result.ids).toHaveLength(objects.length);
    store.destroy();

    // A fresh board: the test generator would hand out the same ids again.
    const fresh = new YjsDocumentStore();
    const refused = expectRejected(fresh, createObjectsCommand, {
      objects: objects.map((entry) =>
        entry.id === 'nested'
          ? { ...entry, overrides: { 'icon-a-leaf': { color: [0, 1, 0, 1] } } }
          : entry,
      ),
    });
    expect(codesOf(refused)).toEqual(['invalid-override']);
    expect(refused[0]?.path).toEqual(['objects', 8, 'overrides', expect.any(String)]);
    fresh.destroy();
  });
});
