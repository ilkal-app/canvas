// CONTRACT: section membership follows ancestry and page geometry; a single
// selected frame scopes a vote, and tied results retain the service's order.
import { expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { voteBoardStore } from './__fixtures__/vote-board.js';
import { voteSession } from './__fixtures__/vote-session.js';
import { isInVoteScope, rankedStickiesOf, voteScopeOf } from './vote-board.js';

it('scopes only an exactly single selected frame', () => {
  const { store } = voteBoardStore();
  expect(voteScopeOf(store, ['ideas' as ObjectId])).toBe('ideas');
  expect(voteScopeOf(store, [])).toBeNull();
  expect(voteScopeOf(store, ['ideas', 'over'] as ObjectId[])).toBeNull();
  expect(voteScopeOf(store, ['over'] as ObjectId[])).toBeNull();
});

it('counts a sticky nested in a rotated section and a centre exactly on its edge', () => {
  const { store } = voteBoardStore();
  const frame = store.get('ideas' as ObjectId);
  const inside = store.get('inside' as ObjectId);
  const over = store.get('over' as ObjectId);
  if (frame?.type !== 'frame' || inside?.type !== 'sticky' || over?.type !== 'sticky') {
    throw new Error('Missing vote fixtures');
  }
  const objects = new Map<ObjectId, BoardObject>([
    [frame.id, { ...frame, rotation: Math.PI / 4 }],
    [inside.id, { ...inside, parentId: 'group' as ObjectId }],
    ['group' as ObjectId, { ...frame, id: 'group' as ObjectId, type: 'group', parentId: frame.id }],
  ]);
  const reader = { get: (id: ObjectId) => objects.get(id) ?? store.get(id) };
  expect(isInVoteScope(reader, 'inside', 'ideas')).toBe(true);
  const edgeReader = {
    get: (id: ObjectId) => (id === over.id ? { ...over, x: 500, y: 100 } : store.get(id)),
  };
  // The root sticky's 200 px box has its centre at x=600, the section's right edge.
  expect(isInVoteScope(edgeReader, 'over', 'ideas')).toBe(true);
});

it('rejects identical coordinates on another page and preserves ties in service order', () => {
  const { store } = voteBoardStore();
  expect(isInVoteScope(store, 'over', 'ideas')).toBe(true);
  expect(isInVoteScope(store, 'elsewhere', 'ideas')).toBe(false);
  const session = voteSession({
    scopeId: 'ideas',
    results: [
      { objectId: 'over', count: 2 },
      { objectId: 'inside', count: 2 },
      { objectId: 'elsewhere', count: 2 },
    ],
  });
  expect(rankedStickiesOf(store, session).map(({ id }) => id)).toEqual(['over', 'inside']);
});
