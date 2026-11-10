// Mains and instances in the layers panel (ruling 7): a main lists its real children
// as a frame does; an instance is a leaf, its main's content never listed under it.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import {
  createComponentBoard,
  createRectangle,
} from '../../engine/__fixtures__/component-board.js';

import { buildLayerRows, isContainerType } from './layer-rows.js';
import { LayerTree } from './layer-tree.js';

describe('mains and instances in the layers tree', () => {
  it('counts mains as containers, instances not', () => {
    expect(isContainerType('component')).toBe(true);
    expect(isContainerType('frame')).toBe(true);
    expect(isContainerType('group')).toBe(true);
    expect(isContainerType('instance')).toBe(false);
    expect(isContainerType('shape')).toBe(false);
  });

  it('expands a main to its children and lists no children under an instance', () => {
    const { store } = createComponentBoard();
    const rows = buildLayerRows(store, new Set(['card', 'inst'] as ObjectId[]));
    const card = rows.find(({ id }) => id === 'card');
    expect(card).toMatchObject({ type: 'component', hasChildren: true, isExpanded: true });
    const children = rows.filter(({ parentId }) => parentId === 'card').map(({ id }) => id);
    expect([...children].sort()).toEqual(['badge-in-card', 'body', 'note', 'photo', 'title']);
    expect(rows.find(({ id }) => id === 'badge-in-card')).toMatchObject({
      type: 'instance',
      level: 2,
      hasChildren: false,
    });
    expect(rows.find(({ id }) => id === 'inst')).toMatchObject({
      type: 'instance',
      hasChildren: false,
      isExpanded: false,
    });
    expect(rows.some(({ parentId }) => parentId === 'inst')).toBe(false);
  });

  it('follows a child added to an expanded main', () => {
    const { store } = createComponentBoard();
    const tree = new LayerTree(store);
    store.subscribe((changes) => {
      tree.applyChanges(changes);
    });
    tree.setExpanded(['card' as ObjectId], true);
    createRectangle(store, 'extra', 'card', { x: 10, y: 10, width: 20, height: 20 });
    expect(tree.rows().find(({ id }) => id === 'extra')).toMatchObject({
      parentId: 'card',
      level: 2,
    });
  });
});
