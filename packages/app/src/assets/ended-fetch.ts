import type { AssetsFetch } from './assets-http.js';

/** Why an asset request is not made: the board's session ended. */
export const SESSION_ENDED_REQUEST_MESSAGE = 'The session ended: no request is made.';

/**
 * A fetch that refuses, before reaching the network, once the board's session ended:
 * every request of the engine's asset adapter goes through it, one that was waiting to be made
 * (a retry, a poll, a tile) included.
 *
 * @param isEnded - Whether the session ended, read at each request.
 * @param base - The fetch to use until then; the thread's own if absent.
 * @returns The fetch.
 */
export function refusingOnceEnded(isEnded: () => boolean, base?: AssetsFetch): AssetsFetch {
  return (input, init) => {
    if (isEnded()) return Promise.reject(new Error(SESSION_ENDED_REQUEST_MESSAGE));
    return base === undefined ? fetch(input, init) : base(input, init);
  };
}
