// Review cases: layer names that are not id-shaped, and names that equal a listed id.
import { describe, expect, it } from 'vitest';

import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand } from './__fixtures__/command-fixtures.js';
import { newRectangle, newText } from './__fixtures__/component-boards.js';
import { overridesOf } from './__fixtures__/component-fixtures.js';
import { createObjectsCommand } from './create-objects.js';

/**
 * A listed main with a text child of a given listed id and name.
 *
 * @param childId - The child's listed id.
 * @param name - The child's layer name.
 * @returns The listed objects.
 */
function listedMain(childId: string, name: string): Record<string, unknown>[] {
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
    { ...newText(childId, 'card', { x: 0, y: 0, width: 120, height: 40 }), name },
  ];
}

/**
 * A listed instance of the listed main.
 *
 * @param overrides - Its overrides.
 * @returns The listed instance.
 */
function listedInstance(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'instance',
    id: 'copy',
    parentId: null,
    mainId: 'card',
    x: 600,
    y: 0,
    width: 400,
    height: 300,
    overrides,
  };
}

describe('createObjects override keys', () => {
  it('resolves a layer name that is no id, spaces and punctuation included', () => {
    const store = new YjsDocumentStore();
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: [
        ...listedMain('title-child', 'Page Title: v2'),
        listedInstance({ 'Page Title: v2': { text: 'Changed' } }),
      ] as never,
    });
    const [, titleId, copyId] = result.ids;
    expect(overridesOf(store, copyId ?? '')).toEqual({ [titleId ?? '']: { text: 'Changed' } });
    store.destroy();
  });

  it('reads a name as a name when an unrelated listed object has that local id', () => {
    const store = new YjsDocumentStore();
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: [
        ...listedMain('title-child', 'Title'),
        newRectangle('Title', null, { x: 900, y: 0, width: 20, height: 20 }),
        listedInstance({ Title: { text: 'Changed' }, 'title-child': { text: 'Again' } }),
      ] as never,
    });
    const [, titleId, , copyId] = result.ids;
    expect(overridesOf(store, copyId ?? '')).toEqual({ [titleId ?? '']: { text: 'Again' } });
    store.destroy();
  });

  it('swaps a slot named by its layer name to a main listed in the same call', () => {
    const store = new YjsDocumentStore();
    const icon = (id: string, x: number): Record<string, unknown> => ({
      type: 'component',
      id,
      parentId: null,
      name: id,
      x,
      y: 400,
      width: 20,
      height: 20,
      retired: false,
    });
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: [
        icon('icon-old', 0),
        icon('icon-new', 40),
        { ...listedMain('title-child', 'Title')[0] },
        {
          type: 'instance',
          id: 'glyph',
          parentId: 'card',
          name: 'Glyph',
          mainId: 'icon-old',
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          overrides: {},
        },
        listedInstance({ Glyph: { mainId: 'icon-new' } }),
      ] as never,
    });
    const [, newIconId, , glyphId, copyId] = result.ids;
    expect(overridesOf(store, copyId ?? '')).toEqual({ [glyphId ?? '']: { mainId: newIconId } });
    store.destroy();
  });
});
