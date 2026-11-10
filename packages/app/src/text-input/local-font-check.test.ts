import { describe, expect, it, vi } from 'vitest';

import {
  LocalFontChecker,
  type FontCheckAnswer,
  type FontCheckRequest,
  type FontCheckWorker,
} from './local-font-check.js';

/** A worker that answers every request readable, or throws when told to on posting. */
class AnsweringWorker implements FontCheckWorker {
  onmessage: ((event: MessageEvent<FontCheckAnswer>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly terminate = vi.fn();

  /**
   * Makes the worker.
   *
   * @param isPostThrowing - Whether posting throws, as a worker that cannot take a file does.
   */
  constructor(private readonly isPostThrowing = false) {}

  /**
   * Answers the request readable, on the next turn.
   *
   * @param request - The request.
   * @throws {Error} When the worker was made to throw on posting.
   */
  postMessage(request: FontCheckRequest): void {
    if (this.isPostThrowing) throw new Error('DataCloneError');
    queueMicrotask(() => {
      this.onmessage?.({
        data: { id: request.id, isReadable: true },
      } as MessageEvent<FontCheckAnswer>);
    });
  }
}

describe('LocalFontChecker when its worker cannot start or take a file', () => {
  it('checks on the page when starting the worker throws, and keeps the queue moving', async () => {
    const checkOnPage = vi.fn(() => Promise.resolve({ isReadable: true } as const));
    const checker = new LocalFontChecker({
      spawn: () => {
        throw new Error('Workers are not allowed here.');
      },
      checkOnPage,
    });
    const checks = await Promise.all([
      checker.check(new ArrayBuffer(4)),
      checker.check(new ArrayBuffer(8)),
    ]);
    expect(checks).toEqual([{ isReadable: true }, { isReadable: true }]);
    expect(checkOnPage).toHaveBeenCalledTimes(2);
  });

  it('refuses a file the worker cannot take, stops it, and starts a fresh one next', async () => {
    const workers = [new AnsweringWorker(true), new AnsweringWorker()];
    let spawned = 0;
    const checker = new LocalFontChecker({
      spawn: () => {
        const worker = workers[spawned];
        spawned += 1;
        return worker;
      },
    });
    const [refused, accepted] = await Promise.all([
      checker.check(new ArrayBuffer(4)),
      checker.check(new ArrayBuffer(4)),
    ]);
    expect(refused).toEqual({ isReadable: false, reason: 'DataCloneError' });
    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);
    expect(accepted).toEqual({ isReadable: true });
    expect(spawned).toBe(2);
  });
});
