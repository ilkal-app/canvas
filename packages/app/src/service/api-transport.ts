import { ApiError, apiErrorFromAnswer, isApiError } from './api-error.js';
import type { Reader } from './reader-kit.js';

/** How long a request may take, answer included, before it counts as unavailable, in ms. */
export const DEFAULT_API_TIMEOUT_MS = 10_000;

/** The pause before a GET that found the service unavailable is asked again, in ms. */
export const DEFAULT_RETRY_DELAY_MS = 500;

/** The header every request carries, which another site cannot set (the service's guard). */
const REQUEST_HEADER = 'X-Canvas-Request';

/** What the transport may be given; tests inject all of it. */
export interface ApiTransportOptions {
  /** The fetch; the window's by default. */
  readonly fetch?: typeof fetch;
  /** How long a request may take, in ms; {@link DEFAULT_API_TIMEOUT_MS} by default. */
  readonly timeoutMs?: number;
  /** The pause before a GET is asked again, in ms; {@link DEFAULT_RETRY_DELAY_MS} by default. */
  readonly retryDelayMs?: number;
  /** Waits; a timer by default. */
  readonly sleep?: (delayMs: number) => Promise<void>;
}

/** One request to the service. */
export interface ApiRequest<T> {
  /** The method. */
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The path, on the page's own origin, its segments already encoded. */
  readonly path: string;
  /** The JSON body, if any. */
  readonly body?: unknown;
  /** Reads the answer's JSON (undefined for an empty one). */
  readonly read: Reader<T>;
  /**
   * A board token to send as `Authorization: Bearer`: a guest's comment calls, which
   * the service authorises by the board token rather than a session. None if absent.
   */
  readonly bearer?: string;
}

/** Sends a request and gives its answer, or rejects with an {@link ApiError}. */
export type ApiTransport = <T>(request: ApiRequest<T>) => Promise<T>;

/**
 * Waits on a timer.
 *
 * @param delayMs - How long, in ms.
 * @returns Resolves after it.
 */
function sleepFor(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Parses JSON, or gives undefined for text that is not JSON.
 *
 * @param text - The text.
 * @returns The value, or undefined.
 */
function parseOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The request's headers: the guard's header on every request, JSON accepted, and a content type
 * only with a body. Never a cookie: the browser sends the session's itself.
 *
 * @param hasBody - Whether a body is sent.
 * @param bearer - A board token to send, if any.
 * @returns The headers.
 */
function headersFor(hasBody: boolean, bearer?: string): Record<string, string> {
  return {
    [REQUEST_HEADER]: '1',
    Accept: 'application/json',
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
  };
}

/**
 * Reads a successful answer with the request's reader.
 *
 * @param request - The request.
 * @param text - The answer's text.
 * @returns What the reader gives.
 * @throws {ApiError} `unavailable` when the text is not JSON or not the expected shape.
 */
function readSuccess<T>(request: ApiRequest<T>, text: string): T {
  const body = text === '' ? undefined : parseOrUndefined(text);
  if (text !== '' && body === undefined) throw new ApiError('unavailable');
  try {
    return request.read(body);
  } catch (error: unknown) {
    throw isApiError(error) ? error : new ApiError('unavailable', { cause: error });
  }
}

/**
 * Makes the site's one way to the boards service (the plan's API contract): `fetch` on the
 * page's own origin with its own credentials (the session cookie, which the page never reads or
 * sets), the `X-Canvas-Request: 1` header on every request, JSON in and out, and a time limit
 * through an `AbortController`. Every refusal of the contract becomes an {@link ApiError} of its
 * code; anything else (no network, a timeout, a `5xx`, a code or body outside the contract)
 * becomes `unavailable`, with nothing of the server's text. A GET that found the service
 * unavailable is asked once more after a pause; a request that changes something never is.
 * Main thread.
 *
 * @param options - The fetch, the limits and the clock.
 * @returns The transport.
 */
export function createApiTransport(options: ApiTransportOptions = {}): ApiTransport {
  const fetchFrom = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const sleep = options.sleep ?? sleepFor;

  const once = async <T>(request: ApiRequest<T>): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const hasBody = request.body !== undefined;
      let response: Response;
      let text: string;
      try {
        response = await fetchFrom(request.path, {
          method: request.method,
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          headers: headersFor(hasBody, request.bearer),
          signal: controller.signal,
          ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
        });
        text = await response.text();
      } catch (cause: unknown) {
        throw new ApiError('unavailable', { cause });
      }
      if (response.ok) return readSuccess(request, text);
      throw apiErrorFromAnswer(
        response.status,
        parseOrUndefined(text),
        response.headers.get('retry-after'),
      );
    } finally {
      clearTimeout(timer);
    }
  };

  return async <T>(request: ApiRequest<T>): Promise<T> => {
    if (request.method !== 'GET') return once(request);
    try {
      return await once(request);
    } catch (error: unknown) {
      if (!isApiError(error, 'unavailable')) throw error;
      await sleep(retryDelayMs);
      return once(request);
    }
  };
}
