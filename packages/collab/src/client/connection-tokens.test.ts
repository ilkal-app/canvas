import { describe, expect, it, vi } from 'vitest';

import { EDITOR_CLAIMS, unsignedToken } from './__fixtures__/unsigned-token.js';
import { ConnectionTokens, type RefreshOutcome, type TokenOutcome } from './connection-tokens.js';
import type { BoardTokenRequest } from './token-source.js';

// The refresh side of a client's tokens: the provider is told `isRefresh`, and only a
// newer token for this board is worth sending; a refused refresh is held against the token sent.

const FIRST = unsignedToken({ ...EDITOR_CLAIMS, exp: 2_000_000_000 });
const LATER = unsignedToken({ ...EDITOR_CLAIMS, exp: 2_000_000_600 });
const EARLIER = unsignedToken({ ...EDITOR_CLAIMS, exp: 1_999_999_000 });

/**
 * Tokens over a provider the test controls, with the first token already handed out.
 *
 * @param provider - Answers each request.
 * @returns The tokens and the requests the provider saw.
 */
async function started(
  provider: (request?: BoardTokenRequest) => string | Promise<string>,
): Promise<{ tokens: ConnectionTokens; requests: (BoardTokenRequest | undefined)[] }> {
  const requests: (BoardTokenRequest | undefined)[] = [];
  const tokens = new ConnectionTokens(
    {
      next: (request) => {
        requests.push(request);
        return provider(request);
      },
    },
    FIRST,
    'board-1',
  );
  const first = await new Promise<TokenOutcome>((resolve) => {
    tokens.request(resolve);
  });
  expect(first).toEqual({ kind: 'token', token: FIRST });
  return { tokens, requests };
}

/**
 * Runs one refresh to its outcome.
 *
 * @param tokens - The tokens.
 * @returns The outcome.
 */
function refreshOnce(tokens: ConnectionTokens): Promise<RefreshOutcome> {
  return new Promise((resolve) => {
    tokens.refresh(resolve);
  });
}

describe('ConnectionTokens.refresh', () => {
  it('asks the provider with isRefresh and returns a token that expires later', async () => {
    const { tokens, requests } = await started(() => LATER);
    expect(await refreshOnce(tokens)).toEqual({ kind: 'token', token: LATER });
    expect(requests).toEqual([{ isAfterRefusal: false, isRefresh: true }]);
  });

  it('finds nothing to send in the same token or one expiring no later', async () => {
    const same = await started(() => FIRST);
    expect(await refreshOnce(same.tokens)).toEqual({ kind: 'stale' });
    const earlier = await started(() => EARLIER);
    expect(await refreshOnce(earlier.tokens)).toEqual({ kind: 'stale' });
  });

  it('refuses a token for another board or one it cannot read', async () => {
    const other = await started(() => unsignedToken({ ...EDITOR_CLAIMS, boardId: 'board-2' }));
    expect(await refreshOnce(other.tokens)).toMatchObject({ kind: 'invalid' });
    const garbage = await started(() => 'not-a-token');
    expect(await refreshOnce(garbage.tokens)).toMatchObject({ kind: 'invalid' });
  });

  it('passes a provider failure on, whether it rejects or throws', async () => {
    const error = new Error('unavailable');
    const rejecting = await started(() => Promise.reject(error));
    expect(await refreshOnce(rejecting.tokens)).toEqual({ kind: 'failed', error });
    const throwing = await started(() => {
      throw error;
    });
    expect(await refreshOnce(throwing.tokens)).toEqual({ kind: 'failed', error });
  });

  it('delivers nothing once cancelled', async () => {
    const { tokens } = await started(() => LATER);
    const deliver = vi.fn();
    tokens.refresh(deliver);
    tokens.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deliver).not.toHaveBeenCalled();
  });

  it('makes the acknowledged token current, so the next refresh must beat it', async () => {
    const { tokens } = await started(() => LATER);
    tokens.refreshSent(LATER);
    tokens.refreshed(LATER);
    expect(await refreshOnce(tokens)).toEqual({ kind: 'stale' });
  });

  it('holds a token-refresh-refused close against the token sent, not the current one', async () => {
    let next = LATER;
    const { tokens } = await started(() => next);
    tokens.refreshSent(LATER);
    expect(tokens.retryAfterRefusal('token-refresh-refused')).toBe(true);
    const refused = await new Promise<TokenOutcome>((resolve) => {
      tokens.request(resolve);
    });
    expect(refused).toEqual({ kind: 'refused', reason: 'token-refresh-refused' });
    next = FIRST;
    const tokensAgain = (await started(() => next)).tokens;
    tokensAgain.refreshSent(LATER);
    expect(tokensAgain.retryAfterRefusal('token-expired')).toBe(true);
    const outcome = await new Promise<TokenOutcome>((resolve) => {
      tokensAgain.request(resolve);
    });
    expect(outcome).toEqual({ kind: 'refused', reason: 'token-expired' });
  });

  it('compares expiries, a missing exp counting as none', async () => {
    const noExpiry = unsignedToken({ ...EDITOR_CLAIMS, exp: undefined });
    const fromNone = await started(() => LATER);
    expect(await refreshOnce(fromNone.tokens)).toEqual({ kind: 'token', token: LATER });
    const toNone = await started(() => noExpiry);
    expect(await refreshOnce(toNone.tokens)).toEqual({ kind: 'stale' });
    const fresh = new ConnectionTokens({ next: () => noExpiry }, noExpiry, 'board-1');
    expect(await refreshOnce(fresh)).toEqual({ kind: 'stale' });
  });

  it('sends any later token when no token was handed out yet', async () => {
    const tokens = new ConnectionTokens({ next: () => LATER }, FIRST, 'board-1');
    expect(await refreshOnce(tokens)).toEqual({ kind: 'token', token: LATER });
  });
});
