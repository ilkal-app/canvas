import type { BoardSyncClient } from './board-connection.js';

/**
 * How a client's first attempt ended: synced with the relay, refused (the token, or this build
 * by the layout gate), or any other failure.
 */
export type FirstOutcome = 'connected' | 'refused' | 'failed';

/**
 * Waits for a new client's first outcome: `connected` once its first sync completes; `refused`
 * when the relay refused the token (`unauthorized`) or this build cannot read the board
 * (`outdated`); `failed` when the attempt fails
 * (`reconnecting`), the device is offline, or nothing happens within the timeout. Main thread.
 *
 * @param client - The client, connecting.
 * @param timeoutMs - How long to wait, in ms.
 * @returns The outcome.
 */
export function waitForFirstOutcome(
  client: BoardSyncClient,
  timeoutMs: number,
): Promise<FirstOutcome> {
  return new Promise((resolve) => {
    const settle = (outcome: FirstOutcome): void => {
      stop();
      clearTimeout(timer);
      resolve(outcome);
    };
    const check = (): void => {
      const { state } = client.status;
      if (state === 'connected') settle('connected');
      else if (state === 'unauthorized' || state === 'outdated') settle('refused');
      else if (state !== 'connecting') settle('failed');
    };
    const stop = client.subscribe(check);
    const timer = setTimeout(() => {
      settle('failed');
    }, timeoutMs);
    check();
  });
}
