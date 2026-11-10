import { describe, expect, it } from 'vitest';

import { EDITOR_CLAIMS, unsignedToken } from './__fixtures__/unsigned-token.js';
import { decodeBoardToken } from './board-token.js';

describe('decodeBoardToken', () => {
  it("reads a user's claims without verifying the signature", () => {
    expect(decodeBoardToken(unsignedToken(EDITOR_CLAIMS))).toEqual({
      principalId: 'user-ada',
      principalType: 'user',
      boardId: 'board-1',
      role: 'editor',
      expiresAt: 2_000_000_000_000,
    });
  });

  it("reads a guest's claims, which name no operator", () => {
    const token = unsignedToken({
      ...EDITOR_CLAIMS,
      sub: 'g-1',
      principal: 'guest',
      name: 'Sam (guest)',
    });
    expect(decodeBoardToken(token)).toMatchObject({
      principalId: 'g-1',
      principalType: 'guest',
      displayName: 'Sam (guest)',
    });
    expect(() =>
      decodeBoardToken(
        unsignedToken({ ...EDITOR_CLAIMS, principal: 'guest', operatorId: 'user-bob' }),
      ),
    ).toThrow(RangeError);
  });

  it("reads a demo board visitor's claims, which name no operator", () => {
    const token = unsignedToken({
      ...EDITOR_CLAIMS,
      sub: 'v-1',
      principal: 'demo',
      role: 'viewer',
    });
    expect(decodeBoardToken(token)).toMatchObject({
      principalId: 'v-1',
      principalType: 'demo',
      role: 'viewer',
    });
    expect(() =>
      decodeBoardToken(unsignedToken({ ...EDITOR_CLAIMS, principal: 'demo', operatorId: 'u-1' })),
    ).toThrow(RangeError);
  });

  it("reads an agent's operator and non-ASCII claims", () => {
    const token = unsignedToken({
      sub: 'agent-ñ',
      boardId: 'board-é',
      role: 'viewer',
      principal: 'agent',
      operatorId: 'user-ada',
    });
    expect(decodeBoardToken(token)).toEqual({
      principalId: 'agent-ñ',
      principalType: 'agent',
      boardId: 'board-é',
      role: 'viewer',
      operatorId: 'user-ada',
    });
  });

  it('reads the signed name without trusting the client presence option', () => {
    expect(
      decodeBoardToken(unsignedToken({ ...EDITOR_CLAIMS, name: 'Ada Verified' })),
    ).toMatchObject({ displayName: 'Ada Verified' });
  });

  it('reads the signed feature flags as signed, and none from a token without them', () => {
    const token = unsignedToken({
      ...EDITOR_CLAIMS,
      features: { 'mode.design': true, agents: 'maybe', retired: true, count: 3 },
    });
    // The registry is private (@canvas/plans): the client keeps the boolean and string values.
    expect(decodeBoardToken(token).features).toEqual({
      'mode.design': true,
      agents: 'maybe',
      retired: true,
    });
    expect(decodeBoardToken(unsignedToken(EDITOR_CLAIMS))).not.toHaveProperty('features');
    expect(
      decodeBoardToken(unsignedToken({ ...EDITOR_CLAIMS, features: 'all' })),
    ).not.toHaveProperty('features');
  });

  it('reads a board lock and ignores absent or malformed lock claims', () => {
    expect(
      decodeBoardToken(unsignedToken({ ...EDITOR_CLAIMS, lock: { boards: 5 } })),
    ).toMatchObject({ lock: { boards: 5 } });
    expect(decodeBoardToken(unsignedToken(EDITOR_CLAIMS))).not.toHaveProperty('lock');
    for (const lock of [null, {}, { boards: -1 }, { boards: '5' }, { boards: 5.5 }]) {
      expect(decodeBoardToken(unsignedToken({ ...EDITOR_CLAIMS, lock }))).not.toHaveProperty(
        'lock',
      );
    }
  });

  it('returns frozen claims', () => {
    expect(Object.isFrozen(decodeBoardToken(unsignedToken(EDITOR_CLAIMS)))).toBe(true);
  });

  it('rejects a token that is not three segments of base64url JSON', () => {
    for (const token of ['', 'a.b', 'a.b.c.d', 'x.!!!.y', `x.${btoa('not json')}.y`]) {
      expect(() => decodeBoardToken(token)).toThrow(RangeError);
    }
    expect(() => decodeBoardToken(`x.${btoa('[1]')}.y`)).toThrow(RangeError);
  });

  it('rejects a payload missing a claim or with a claim of the wrong kind', () => {
    const malformed = [
      { ...EDITOR_CLAIMS, sub: '' },
      { ...EDITOR_CLAIMS, boardId: 7 },
      { ...EDITOR_CLAIMS, role: 'admin' },
      { ...EDITOR_CLAIMS, principal: 'robot' },
      { ...EDITOR_CLAIMS, exp: 'soon' },
      { ...EDITOR_CLAIMS, name: 7 },
      { ...EDITOR_CLAIMS, name: null },
      { ...EDITOR_CLAIMS, operatorId: 'user-bob' },
      { ...EDITOR_CLAIMS, principal: 'agent' },
    ];
    for (const claims of malformed) {
      expect(() => decodeBoardToken(unsignedToken(claims))).toThrow(RangeError);
    }
  });
});
