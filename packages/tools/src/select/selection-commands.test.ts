import { describe, expect, it } from 'vitest';

import { group, id, rect, selectBoardObjects } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { deleteSelectionObjects, selectAllIdsOf } from './selection-commands.js';

describe('selection commands', () => {
  it('select all takes the unlocked root objects, or an entered group’s children', () => {
    const store = createSelectStore();
    const source = storeSource(store);
    const all = selectAllIdsOf(store, source, null);
    expect(all).toContain(id('rect-a'));
    expect(all).toContain(id('group-g'));
    expect(all).not.toContain(id('rect-locked'));
    expect(all).not.toContain(id('rect-c'));
    expect(selectAllIdsOf(store, source, id('group-g'))).toEqual([id('rect-d'), id('group-h')]);
  });

  it('deletes the movable objects in one change set and names groups holding a locked one', () => {
    const store = createSelectStore([
      ...selectBoardObjects(),
      group('group-locked', null, 0, 900),
      rect('rect-held', 'group-locked', { x: 0, y: 0, width: 10, height: 10, isLocked: true }),
    ]);
    const changeSets: unknown[] = [];
    store.subscribe((changes) => changeSets.push(changes));
    const ids = [id('rect-a'), id('rect-locked'), id('group-locked')];
    const held = deleteSelectionObjects(
      store,
      { origin: ADA, environment: ENVIRONMENT },
      ids,
      storeSource(store),
    );
    expect(held).toEqual([id('group-locked')]);
    expect(store.get(id('rect-a'))).toBeUndefined();
    expect(store.get(id('rect-locked'))).toBeDefined();
    expect(store.get(id('group-locked'))).toBeDefined();
    expect(changeSets).toHaveLength(1);
  });

  it.each([
    ['detaches', 'detach'],
    ['deletes', 'delete'],
  ] as const)('%s the connectors on a deleted object, as the person prefers', (verb, policy) => {
    const store = createSelectStore();
    const attribution = { origin: ADA, environment: ENVIRONMENT };
    deleteSelectionObjects(store, attribution, [id('rect-a')], storeSource(store), policy);
    const connector = store.get(id('connector-k'));
    if (verb === 'deletes') expect(connector).toBeUndefined();
    else expect(connector).toMatchObject({ from: { kind: 'point' } });
  });

  it('writes nothing when nothing selected is movable', () => {
    const store = createSelectStore();
    const changeSets: unknown[] = [];
    store.subscribe((changes) => changeSets.push(changes));
    const attribution = { origin: ADA, environment: ENVIRONMENT };
    expect(
      deleteSelectionObjects(store, attribution, [id('rect-locked')], storeSource(store)),
    ).toEqual([]);
    expect(changeSets).toEqual([]);
  });
});
