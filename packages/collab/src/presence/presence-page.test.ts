import { describe, expect, it } from 'vitest';

import { mergePresence } from './presence-merge.js';
import type { PresenceState } from './presence-state.js';

const STATE: PresenceState = {
  principal: { id: 'user-1', kind: 'user', name: 'Ada', color: '#1f77b4' },
  updatedAt: 0,
};

describe('the page in presence', () => {
  it('sets, keeps and clears the page shown', () => {
    const onPage = mergePresence(STATE, { page: 'p-2' }, 1);
    expect(onPage).toMatchObject({ page: 'p-2', updatedAt: 1 });
    expect(mergePresence(onPage, { cursor: { x: 1, y: 2 } }, 2).page).toBe('p-2');
    expect('page' in mergePresence(onPage, { page: null }, 3)).toBe(false);
  });

  it('refuses a page that is not an id', () => {
    expect(() => mergePresence(STATE, { page: 'not an id' }, 1)).toThrow(RangeError);
  });
});
