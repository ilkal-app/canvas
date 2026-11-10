import { describe, expect, it } from 'vitest';

import { BoardTokens } from './board-tokens.js';
import { NO_IMAGES_MESSAGE } from './page-images-messages.js';
import type { BoardImageAccess } from './page-images-types.js';

/**
 * Board access whose token fetches are recorded: each returns `token-<n>`, fresh or not.
 *
 * @returns The access and its fetches.
 */
function accessOf() {
  const fetches: boolean[] = [];
  const access = {
    assetsUrl: 'http://assets.test',
    boardId: 'board-a',
    token: (isFresh: boolean) => {
      fetches.push(isFresh);
      return Promise.resolve(`token-${String(fetches.length)}`);
    },
  } as unknown as BoardImageAccess;
  return { access, fetches };
}

describe('BoardTokens', () => {
  it("does not take the connected engine's first ask for a repeat after only attached links asked", async () => {
    const { access, fetches } = accessOf();
    const tokens = new BoardTokens(access, undefined, () => false);
    await tokens.answer(false);
    await tokens.answer();
    expect(fetches).toEqual([false]);
    await tokens.answer();
    expect(fetches).toEqual([false, true]);
  });

  it("takes the connected engine's first ask for a repeat once the page itself used the token", async () => {
    const { access, fetches } = accessOf();
    const tokens = new BoardTokens(access, undefined, () => false);
    await tokens.answer(false);
    await tokens.current(false);
    await tokens.answer();
    expect(fetches).toEqual([false, true]);
    await tokens.answer(true);
    expect(fetches).toEqual([false, true, true]);
  });

  it('gives null without an assets service, nothing once the session ended, and no client then', async () => {
    const none = new BoardTokens(undefined, undefined, () => false);
    await expect(none.answer()).resolves.toBeNull();
    expect(() => none.http()).toThrow(NO_IMAGES_MESSAGE);
    const ended = new BoardTokens(accessOf().access, undefined, () => true);
    await expect(ended.answer()).resolves.toBeUndefined();
    await expect(ended.refresh()).rejects.toThrow('session ended');
  });
});
