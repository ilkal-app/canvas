import { describe, expect, it } from 'vitest';

import { isPresenceState } from './presence-guard.js';

const state = {
  principal: { id: 'user-1', kind: 'user', name: 'Ada', color: '#1f77b4' },
  updatedAt: 0,
};
describe('presence page boundary', () => {
  it('accepts legacy presence and valid page ids', () => {
    expect(isPresenceState(state)).toBe(true);
    expect(isPresenceState({ ...state, page: 'page-1' })).toBe(true);
  });
  it.each([17, {}, [], '', 'bad page id'])('rejects invalid page %j', (page) => {
    expect(isPresenceState({ ...state, page })).toBe(false);
  });
});
