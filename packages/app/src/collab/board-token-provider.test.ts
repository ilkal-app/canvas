import { describe, expect, it, vi } from 'vitest';

import type { BoardAddress } from './board-address.js';
import { createBoardTokenProvider } from './board-token-provider.js';

const ADDRESS: BoardAddress = {
  boardId: 'team plan',
  relayUrl: 'ws://127.0.0.1:1234',
  token: undefined,
  tokenUrl: 'http://127.0.0.1:1235/token',
  assetsUrl: undefined,
};

/**
 * A fetch that answers every request with the given body and status.
 *
 * @param body - The JSON body.
 * @param status - The HTTP status.
 * @returns The fetch, a spy.
 */
function answering(body: unknown, status = 200): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(() => Promise.resolve(Response.json(body, { status })));
}

describe('createBoardTokenProvider', () => {
  it('hands out the token the page was given, every time', async () => {
    const fetchToken = answering({ token: 'unused' });
    const getToken = createBoardTokenProvider({
      address: { ...ADDRESS, token: 'given.token.here' },
      subject: () => 'guest-1',
      fetch: fetchToken,
    });
    await expect(getToken()).resolves.toBe('given.token.here');
    await expect(getToken()).resolves.toBe('given.token.here');
    expect(fetchToken).not.toHaveBeenCalled();
  });

  it('fetches a fresh token for the board and subject on every call', async () => {
    const fetchToken = answering({ token: 'fresh.token.x' });
    const getToken = createBoardTokenProvider({
      address: ADDRESS,
      subject: () => 'guest-1',
      fetch: fetchToken,
    });
    await expect(getToken()).resolves.toBe('fresh.token.x');
    await getToken();
    expect(fetchToken).toHaveBeenCalledTimes(2);
    const [url, init] = fetchToken.mock.calls[0] ?? [];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe('http://127.0.0.1:1235/token?board=team+plan&sub=guest-1');
    expect(init).toEqual({ cache: 'no-store' });
  });

  it('rejects when the endpoint refuses or answers something that is not a token', async () => {
    const refusing = createBoardTokenProvider({
      address: ADDRESS,
      subject: () => 'guest-1',
      fetch: answering({ error: 'nope' }, 403),
    });
    await expect(refusing()).rejects.toThrow(/403/);
    const odd = createBoardTokenProvider({
      address: ADDRESS,
      subject: () => 'guest-1',
      fetch: answering({ token: 42 }),
    });
    await expect(odd()).rejects.toThrow(/no token/);
  });

  it('refuses an address with neither a token nor a token endpoint', () => {
    expect(() =>
      createBoardTokenProvider({
        address: { ...ADDRESS, relayUrl: undefined, tokenUrl: undefined },
        subject: () => 'guest-1',
      }),
    ).toThrow(RangeError);
  });

  it('fetches with the page’s fetch by default', async () => {
    const fetchToken = answering({ token: 'from.window.fetch' });
    vi.stubGlobal('fetch', fetchToken);
    try {
      const getToken = createBoardTokenProvider({ address: ADDRESS, subject: () => 'guest-1' });
      await expect(getToken()).resolves.toBe('from.window.fetch');
      expect(fetchToken).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
