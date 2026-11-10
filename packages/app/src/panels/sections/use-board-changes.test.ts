// What the component sections follow of the whole board (part B1).
import { describe, expect, it } from 'vitest';

import type { BoardReader, ChangeSet } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { createComponentBoard } from '../../engine/__fixtures__/component-board.js';
import { LOCAL_USER_ORIGIN } from '../../engine/demo-document.js';

import { mainAndInstancesOf, mainClosureOf, touchesAny } from './use-board-changes.js';

describe('what the component sections follow', () => {
  it('follows a main, its content and its nested mains’ content', () => {
    const { store } = createComponentBoard();
    const closure = [...mainClosureOf(store, 'card' as ObjectId)].sort();
    expect(closure).toEqual(
      ['badge', 'badge-in-card', 'body', 'card', 'dot', 'note', 'photo', 'title'].sort(),
    );
    expect([...mainClosureOf(store, 'gone' as ObjectId)]).toEqual(['gone']);
  });

  it('follows the swaps its instances name, skipping an instance the board no longer holds', () => {
    const { store } = createComponentBoard();
    const reader = {
      get: (id: ObjectId) => (id === 'inst' ? undefined : store.get(id)),
      references: {
        childrenOf: (id: ObjectId) => store.references.childrenOf(id),
        instancesOf: () => ['inst', 'other'] as ObjectId[],
      },
    } as unknown as BoardReader;
    const other = {
      type: 'instance',
      id: 'other',
      mainId: 'card',
      overrides: { x: { mainId: 'b' } },
    };
    const withOther = {
      ...reader,
      get: (id: ObjectId) => (id === 'other' ? other : reader.get(id)),
    } as unknown as BoardReader;
    expect(mainClosureOf(reader, 'card' as ObjectId).has('b' as ObjectId)).toBe(false);
    expect(mainClosureOf(withOther, 'card' as ObjectId).has('b' as ObjectId)).toBe(true);
  });

  it('follows a main and its instances', () => {
    const { store } = createComponentBoard({ isInstanceOnSecondPage: true });
    expect([...mainAndInstancesOf(store, 'card' as ObjectId)].sort()).toEqual(['card', 'inst']);
  });

  it('tells a change set that touched one of the ids', () => {
    const changes = (fields: Partial<ChangeSet>): ChangeSet => ({
      origin: LOCAL_USER_ORIGIN,
      isLocal: true,
      created: [],
      updated: [],
      deleted: [],
      ...fields,
    });
    const ids = new Set(['a', 'b'] as ObjectId[]);
    expect(touchesAny(changes({ created: ['b'] as ObjectId[] }), ids)).toBe(true);
    expect(touchesAny(changes({ updated: ['a'] as ObjectId[] }), ids)).toBe(true);
    expect(touchesAny(changes({ deleted: ['a'] as ObjectId[] }), ids)).toBe(true);
    expect(touchesAny(changes({ updated: ['c'] as ObjectId[] }), ids)).toBe(false);
  });
});
