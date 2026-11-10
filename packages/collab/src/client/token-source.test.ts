import { describe, expect, it, vi } from 'vitest';

import { EDITOR_CLAIMS, unsignedToken } from './__fixtures__/unsigned-token.js';
import {
  createTokenSource,
  readBoardTokenFor,
  resolveTokenProvider,
  type BoardTokenRequest,
} from './token-source.js';

const TOKEN = unsignedToken(EDITOR_CLAIMS);

describe('createTokenSource', () => {
  it('hands out a fixed token synchronously, the same one every time', () => {
    const source = createTokenSource({ token: TOKEN });
    expect(source.next()).toBe(TOKEN);
    expect(source.next()).toBe(TOKEN);
  });

  it('asks the provider for every token', async () => {
    const getToken = vi.fn(() => Promise.resolve(TOKEN));
    const source = createTokenSource({ getToken });
    await expect(source.next()).resolves.toBe(TOKEN);
    await expect(source.next()).resolves.toBe(TOKEN);
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('tells the provider whether a request follows a refusal, not by default', async () => {
    const getToken = vi.fn<(request?: BoardTokenRequest) => Promise<string>>(() =>
      Promise.resolve(TOKEN),
    );
    const source = createTokenSource({ getToken });
    await source.next();
    await source.next({ isAfterRefusal: true });
    expect(getToken.mock.calls).toEqual([[{ isAfterRefusal: false }], [{ isAfterRefusal: true }]]);
  });

  it('turns a provider that throws instead of rejecting into a rejection', async () => {
    const source = createTokenSource({
      getToken: () => {
        throw new Error('no session');
      },
    });
    await expect(source.next()).rejects.toThrow('no session');
  });

  it('refuses options with neither a token nor a provider, or with both', () => {
    expect(() => createTokenSource({})).toThrow(RangeError);
    expect(() =>
      createTokenSource({ token: TOKEN, getToken: () => Promise.resolve(TOKEN) }),
    ).toThrow(RangeError);
  });
});

describe('resolveTokenProvider', () => {
  it('wraps a fixed token in a provider, for callers that only take one', async () => {
    await expect(resolveTokenProvider({ token: TOKEN })()).resolves.toBe(TOKEN);
  });

  it('returns a given provider as it is', () => {
    const getToken = (): Promise<string> => Promise.resolve(TOKEN);
    expect(resolveTokenProvider({ getToken })).toBe(getToken);
  });
});

describe('readBoardTokenFor', () => {
  it("reads a token's claims when it opens the board", () => {
    expect(readBoardTokenFor(TOKEN, 'board-1').principalId).toBe('user-ada');
  });

  it('refuses a token for another board, and one that is not a token', () => {
    expect(() => readBoardTokenFor(TOKEN, 'board-2')).toThrow(/opens board "board-1"/);
    expect(() => readBoardTokenFor('not-a-token', 'board-1')).toThrow(RangeError);
  });
});
