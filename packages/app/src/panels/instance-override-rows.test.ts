import { describe, expect, it } from 'vitest';

import type { InstanceObject, ObjectId } from '@canvas/schema';

import {
  createComponentBoard,
  createRectangle,
  mustRun,
} from '../engine/__fixtures__/component-board.js';

import { instanceOverrideRows } from './instance-override-rows.js';

/**
 * The stored card instance.
 *
 * @param store - The board.
 * @param store.get - Its reader.
 * @param id - The instance's id.
 * @returns It.
 * @throws {Error} When it is not an instance.
 */
function instanceOf(store: { get(id: ObjectId): unknown }, id = 'inst'): InstanceObject {
  const object = store.get(id as ObjectId) as InstanceObject | undefined;
  if (object?.type !== 'instance') throw new Error(`${id} is not an instance`);
  return object;
}

describe('instanceOverrideRows (ruling 1)', () => {
  it('lists each child of the main top first, a nested instance’s children under its path', () => {
    const { store } = createComponentBoard();
    const rows = instanceOverrideRows(store, instanceOf(store));
    expect(rows.map(({ path, depth }) => [path, depth])).toEqual([
      ['badge-in-card', 0],
      ['badge-in-card/dot', 1],
      ['photo', 0],
      ['note', 0],
      ['title', 0],
      ['body', 0],
    ]);
  });

  it('gives each row the fields its type takes, from the schema', () => {
    const { store } = createComponentBoard();
    const fields = new Map(
      instanceOverrideRows(store, instanceOf(store)).map((row) => [row.path, row.fields]),
    );
    expect(fields.get('title')).toEqual(['isHidden', 'opacity', 'text', 'textStyle', 'runs']);
    expect(fields.get('note')).toEqual([
      'isHidden',
      'opacity',
      'text',
      'textStyle',
      'runs',
      'color',
    ]);
    expect(fields.get('body')).toEqual([
      'isHidden',
      'opacity',
      'text',
      'textStyle',
      'runs',
      'fill',
      'strokeColor',
    ]);
    expect(fields.get('photo')).toEqual(['isHidden', 'opacity', 'assetId', 'naturalSize', 'crop']);
    expect(fields.get('badge-in-card')).toEqual(['isHidden', 'opacity']);
    expect(fields.get('badge-in-card/dot')).toEqual([
      'isHidden',
      'opacity',
      'text',
      'textStyle',
      'runs',
      'fill',
      'strokeColor',
    ]);
  });

  it('carries the source child and the override stored at its path', () => {
    const { store } = createComponentBoard();
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'badge-in-card/dot',
      override: { fill: [0, 1, 0, 1] },
    });
    const rows = instanceOverrideRows(store, instanceOf(store));
    const dot = rows.find((row) => row.path === 'badge-in-card/dot');
    expect(dot?.source.id).toBe('dot');
    expect(dot?.override).toEqual({ fill: [0, 1, 0, 1] });
    expect(rows.find((row) => row.path === 'title')?.override).toBeUndefined();
  });

  it('descends into containers inside the main, and leaves out comments', () => {
    const { store } = createComponentBoard();
    createRectangle(store, 'inner', 'card', { x: 0, y: 0, width: 5, height: 5 });
    mustRun(store, 'group', { ids: ['inner', 'title'], groupId: 'pair' });
    const rows = instanceOverrideRows(store, instanceOf(store));
    const pair = rows.findIndex((row) => row.path === 'pair');
    expect(rows[pair]?.depth).toBe(0);
    expect(rows.slice(pair + 1, pair + 3).map(({ path, depth }) => [path, depth])).toEqual([
      ['inner', 1],
      ['title', 1],
    ]);
  });

  it('follows nested instances down to the depth limit', () => {
    const { store } = createComponentBoard();
    let main = 'badge';
    for (let level = 1; level <= 4; level += 1) {
      const id = `level-${String(level)}`;
      mustRun(store, 'createInstance', { componentId: main, x: 0, y: 0, instanceId: `i-${id}` });
      mustRun(store, 'createComponent', { ids: [`i-${id}`], name: id, componentId: id });
      main = id;
    }
    mustRun(store, 'createInstance', { componentId: main, x: 0, y: 0, instanceId: 'deep' });
    const deepest = instanceOverrideRows(store, instanceOf(store, 'deep')).at(-1);
    expect(deepest?.path).toBe('i-level-4/i-level-3/i-level-2/i-level-1/dot');
    expect(deepest?.depth).toBe(4);
  });

  it('is empty when the main cannot be read', () => {
    const { store } = createComponentBoard();
    const orphan = { ...instanceOf(store), mainId: 'gone' as ObjectId };
    expect(instanceOverrideRows(store, orphan)).toEqual([]);
  });
});
