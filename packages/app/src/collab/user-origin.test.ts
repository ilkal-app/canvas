import { describe, expect, it } from 'vitest';

import { userOriginFromClaims } from './user-origin.js';

const CLAIMS = {
  principalId: 'guest-7',
  principalType: 'user',
  boardId: 'demo',
  role: 'editor',
} as const;

describe('userOriginFromClaims', () => {
  it('attributes a person’s edits to user:<sub>', () => {
    expect(userOriginFromClaims(CLAIMS)).toEqual({ kind: 'user', principalId: 'user:guest-7' });
  });

  it('attributes a guest’s edits to guest:<sub> as a person’s', () => {
    expect(userOriginFromClaims({ ...CLAIMS, principalType: 'guest' })).toEqual({
      kind: 'user',
      principalId: 'guest:guest-7',
    });
  });

  it('refuses an agent’s token and a subject that is not a bare id', () => {
    expect(() =>
      userOriginFromClaims({ ...CLAIMS, principalType: 'agent', operatorId: 'ada' }),
    ).toThrow(/agent/);
    expect(() => userOriginFromClaims({ ...CLAIMS, principalId: 'agent:x' })).toThrow(/bare id/);
  });
});
