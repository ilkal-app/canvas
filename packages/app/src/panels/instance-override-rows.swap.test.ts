import { describe, expect, it } from 'vitest';

import type { InstanceObject, ObjectId } from '@canvas/schema';

import {
  createComponentBoard,
  createRectangle,
  mustRun,
} from '../engine/__fixtures__/component-board.js';

import { instanceOverrideRows } from './instance-override-rows.js';

function instanceOf(store: { get(id: ObjectId): unknown }): InstanceObject {
  const object = store.get('inst' as ObjectId) as InstanceObject | undefined;
  if (object?.type !== 'instance') throw new Error('missing card instance');
  return object;
}

function addCheckMain(store: ReturnType<typeof createComponentBoard>['store']): void {
  createRectangle(store, 'check-mark', null, { x: 800, y: 100, width: 20, height: 20 });
  mustRun(store, 'createComponent', {
    ids: ['check-mark'],
    name: 'Check',
    componentId: 'check',
  });
}

describe('instance override rows after a slot swap', () => {
  it('lists the swapped-in main’s children under the slot path and names the effective main', () => {
    const { store } = createComponentBoard();
    addCheckMain(store);
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'badge-in-card',
      override: { mainId: 'check' },
    });
    const rows = instanceOverrideRows(store, instanceOf(store));
    expect(
      rows.filter(({ path }) => path.startsWith('badge-in-card')).map(({ path }) => path),
    ).toEqual(['badge-in-card', 'badge-in-card/check-mark']);
    expect(rows.find(({ path }) => path === 'badge-in-card')?.source).toMatchObject({
      type: 'instance',
      mainId: 'check',
    });
  });

  it('keeps old-main records inactive and restores the stored main’s rows on reset', () => {
    const { store } = createComponentBoard();
    addCheckMain(store);
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'badge-in-card/dot',
      override: { fill: [0, 1, 0, 1] },
    });
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'badge-in-card',
      override: { mainId: 'check' },
    });
    expect(instanceOverrideRows(store, instanceOf(store)).map(({ path }) => path)).not.toContain(
      'badge-in-card/dot',
    );
    mustRun(store, 'resetInstanceOverrides', {
      id: 'inst',
      path: 'badge-in-card',
      fields: ['mainId'],
    });
    const rows = instanceOverrideRows(store, instanceOf(store));
    expect(rows.map(({ path }) => path)).toContain('badge-in-card/dot');
    expect(rows.map(({ path }) => path)).not.toContain('badge-in-card/check-mark');
    expect(rows.find(({ path }) => path === 'badge-in-card/dot')?.override).toEqual({
      fill: [0, 1, 0, 1],
    });
  });
});
