import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_REFUSAL_CODES, ApiError } from './api-error.js';
import { createApiTransport, DEFAULT_API_TIMEOUT_MS } from './api-transport.js';

/** A recorded request of the fake fetch. */
interface SeenRequest {
  readonly url: string;
  readonly init: RequestInit;
}

/**
 * A fetch that answers from a queue and records what it was asked.
 *
 * @param answers - The answers in order: a response, or an error to reject with.
 * @returns The fetch and what it saw.
 */
function fakeFetch(...answers: (Response | Error)[]) {
  const seen: SeenRequest[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: input instanceof Request ? input.url : input.toString(), init: init ?? {} });
    const answer = answers.shift();
    if (answer === undefined) throw new Error('no answer left');
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, seen };
}

/**
 * A JSON response.
 *
 * @param status - The status.
 * @param body - The body.
 * @param headers - More headers.
 * @returns The response.
 */
function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const noWait = () => Promise.resolve();
const readAnything = (body: unknown) => body;

/**
 * Runs a request and returns what it rejected with.
 *
 * @param promise - The request.
 * @returns The error.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('the request did not fail');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createApiTransport', () => {
  it('sends the request header and the page’s own credentials, and never a cookie of its own', async () => {
    const { fetch, seen } = fakeFetch(json(200, { ok: true }), new Response(null, { status: 204 }));
    const send = createApiTransport({ fetch, sleep: noWait });
    await expect(send({ method: 'GET', path: '/api/me', read: readAnything })).resolves.toEqual({
      ok: true,
    });
    await send({ method: 'POST', path: '/api/boards', body: { title: 'A' }, read: () => 'done' });
    const [get, post] = seen;
    expect(get?.url).toBe('/api/me');
    expect(get?.init).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const getHeaders = new Headers(get?.init.headers);
    expect(getHeaders.get('x-canvas-request')).toBe('1');
    expect(getHeaders.get('accept')).toBe('application/json');
    expect(getHeaders.has('content-type')).toBe(false);
    expect(getHeaders.has('cookie')).toBe(false);
    expect(get?.init.body).toBeUndefined();
    const postHeaders = new Headers(post?.init.headers);
    expect(postHeaders.get('x-canvas-request')).toBe('1');
    expect(postHeaders.get('content-type')).toBe('application/json');
    expect(post?.init.body).toBe('{"title":"A"}');
  });

  it('sends a changing request without a body with no content type', async () => {
    const { fetch, seen } = fakeFetch(new Response(null, { status: 204 }));
    const send = createApiTransport({ fetch, sleep: noWait });
    await send({ method: 'POST', path: '/api/auth/sign-out', read: () => undefined });
    expect(new Headers(seen[0]?.init.headers).has('content-type')).toBe(false);
    expect(seen[0]?.init.body).toBeUndefined();
  });

  it('maps every error code of the contract to a typed error, without the server’s words', async () => {
    for (const code of API_REFUSAL_CODES) {
      const { fetch } = fakeFetch(json(409, { error: code, message: 'Server <b>words</b>' }));
      const send = createApiTransport({ fetch, sleep: noWait });
      const error = await rejectionOf(send({ method: 'POST', path: '/x', read: readAnything }));
      expect(error.code, code).toBe(code);
      expect(error.status).toBe(409);
      expect(error.message).not.toContain('Server');
    }
  });

  it('carries the invitation’s address hint and the retry delay', async () => {
    const { fetch } = fakeFetch(
      json(409, { error: 'wrong-address', message: 'm', invitedEmailHint: 'j***@example.com' }),
      json(429, { error: 'email-limit', message: 'm' }, { 'retry-after': '120' }),
      json(409, { error: 'wrong-address', message: 'm', invitedEmailHint: 42 }),
    );
    const send = createApiTransport({ fetch, sleep: noWait });
    const request = { method: 'POST', path: '/x', read: readAnything } as const;
    const wrongAddress = await rejectionOf(send(request));
    expect(wrongAddress).toMatchObject({
      code: 'wrong-address',
      invitedEmailHint: 'j***@example.com',
    });
    expect(await rejectionOf(send(request))).toMatchObject({
      code: 'email-limit',
      retryAfterSeconds: 120,
    });
    expect((await rejectionOf(send(request))).invitedEmailHint).toBeUndefined();
  });

  it('answers “unavailable” for anything outside the contract', async () => {
    const answers: (Response | Error)[] = [
      json(500, { error: 'internal', message: 'stack trace' }),
      json(503, { error: 'stopping', message: 'm' }),
      json(418, { error: 'teapot', message: 'm' }),
      new Response('<html>Bad gateway</html>', { status: 502 }),
      new Response('not json', { status: 200 }),
      json(404, 'not-found'),
      new TypeError('Failed to fetch'),
    ];
    for (const answer of answers) {
      const { fetch } = fakeFetch(answer);
      const send = createApiTransport({ fetch, sleep: noWait });
      const error = await rejectionOf(send({ method: 'POST', path: '/x', read: readAnything }));
      expect(error.code).toBe('unavailable');
      expect(error.message).not.toMatch(/stack|gateway|Failed/);
    }
  });

  it('answers “unavailable” for an answer of the wrong shape', async () => {
    const { fetch } = fakeFetch(json(200, { user: 'nobody' }));
    const send = createApiTransport({ fetch, sleep: noWait });
    const read = (): never => {
      throw new TypeError('bad shape');
    };
    expect((await rejectionOf(send({ method: 'POST', path: '/x', read }))).code).toBe(
      'unavailable',
    );
  });

  it('keeps a typed error the reader throws', async () => {
    const { fetch } = fakeFetch(json(200, {}));
    const send = createApiTransport({ fetch, sleep: noWait });
    const read = (): never => {
      throw new ApiError('not-found', { status: 404 });
    };
    expect((await rejectionOf(send({ method: 'GET', path: '/x', read }))).code).toBe('not-found');
  });

  it('gives up on a request that takes too long', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (...[, init]: Parameters<typeof globalThis.fetch>) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const send = createApiTransport({ fetch, sleep: noWait });
    const result = rejectionOf(send({ method: 'POST', path: '/x', read: readAnything }));
    await vi.advanceTimersByTimeAsync(DEFAULT_API_TIMEOUT_MS);
    expect((await result).code).toBe('unavailable');
  });

  it('asks a GET once more after a pause when the service was unavailable', async () => {
    const { fetch, seen } = fakeFetch(new TypeError('offline'), json(200, { ok: 1 }));
    const sleep = vi.fn(noWait);
    const send = createApiTransport({ fetch, sleep, retryDelayMs: 750 });
    await expect(send({ method: 'GET', path: '/x', read: readAnything })).resolves.toEqual({
      ok: 1,
    });
    expect(seen).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(750);
  });

  it('asks a GET at most twice', async () => {
    const { fetch, seen } = fakeFetch(json(500, {}), json(502, {}), json(200, {}));
    const send = createApiTransport({ fetch, sleep: noWait });
    const error = await rejectionOf(send({ method: 'GET', path: '/x', read: readAnything }));
    expect(error.code).toBe('unavailable');
    expect(seen).toHaveLength(2);
  });

  it('never asks a changing request again, nor a GET that was refused', async () => {
    const { fetch, seen } = fakeFetch(
      new TypeError('offline'),
      json(404, { error: 'not-found', message: 'm' }),
    );
    const send = createApiTransport({ fetch, sleep: noWait });
    for (const method of ['POST', 'GET'] as const) {
      await rejectionOf(send({ method, path: '/x', read: readAnything }));
    }
    expect(seen).toHaveLength(2);
  });

  it('uses the window’s fetch and a real pause by default', async () => {
    const answer = json(200, { ok: 2 });
    const windowFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(answer);
    const send = createApiTransport();
    await expect(send({ method: 'GET', path: '/x', read: readAnything })).resolves.toEqual({
      ok: 2,
    });
    expect(windowFetch).toHaveBeenCalledTimes(1);
  });

  it('pauses on a timer between the two tries of a GET by default', async () => {
    const { fetch, seen } = fakeFetch(json(503, {}), json(200, { ok: 3 }));
    const send = createApiTransport({ fetch, retryDelayMs: 1 });
    await expect(send({ method: 'GET', path: '/x', read: readAnything })).resolves.toEqual({
      ok: 3,
    });
    expect(seen).toHaveLength(2);
  });
});
