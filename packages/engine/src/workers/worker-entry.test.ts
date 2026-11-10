import { describe, expect, it } from 'vitest';

import { createDefaultJobHandlers } from './default-job-handlers.js';
import type { JobHandlers } from './job-handlers.js';
import { createJobRequestMessage, type TransferList } from './protocol.js';
import { createWorkerEntry, type ReplyPoster } from './worker-entry.js';

interface Posted {
  readonly message: unknown;
  readonly transfer: TransferList;
}

/**
 * Creates a poster that records what it posts, throwing `failures` (in order) first.
 *
 * @param failures - Errors to throw from the first posts, as `postMessage` would.
 * @returns The poster and what it posted.
 */
function createPoster(...failures: Error[]): { post: ReplyPoster; posted: Posted[] } {
  const posted: Posted[] = [];
  const post: ReplyPoster = (message, transfer) => {
    const failure = failures.shift();
    if (failure !== undefined) throw failure;
    posted.push({ message, transfer });
  };
  return { post, posted };
}

function createDataCloneError(): Error {
  const error = new Error('An ArrayBuffer is detached and could not be cloned.');
  error.name = 'DataCloneError';
  return error;
}

describe('createWorkerEntry', () => {
  it('serves echo out of the box, transferring the bytes back', async () => {
    const { post, posted } = createPoster();
    const bytes = new ArrayBuffer(8);

    await createWorkerEntry(createDefaultJobHandlers()).onMessage(
      createJobRequestMessage(1, 'echo', { message: 'ping', bytes }),
      post,
    );

    expect(posted).toEqual([
      {
        message: { type: 'job-result', id: 1, payload: { message: 'ping', bytes } },
        transfer: [bytes],
      },
    ]);
  });

  it('runs the handlers it was given instead of the defaults', async () => {
    const handlers: JobHandlers = {
      decode: (request) => ({ response: { assetId: request.assetId, levels: [] }, transfer: [] }),
    };
    const entry = createWorkerEntry(handlers);
    const { post, posted } = createPoster();

    await entry.onMessage(
      createJobRequestMessage(2, 'decode', {
        assetId: 'asset-1',
        bytes: new ArrayBuffer(0),
        mimeType: 'image/avif',
        longEdgesPx: [128],
      }),
      post,
    );
    await entry.onMessage(
      createJobRequestMessage(3, 'echo', { message: '', bytes: new ArrayBuffer(0) }),
      post,
    );

    expect(posted[0]?.message).toMatchObject({ type: 'job-result', id: 2 });
    expect(posted[1]?.message).toMatchObject({
      type: 'job-error',
      failure: { code: 'no-handler' },
    });
  });

  it('answers a malformed request that has an id with invalid-request', async () => {
    const { post, posted } = createPoster();

    await createWorkerEntry(createDefaultJobHandlers()).onMessage(
      { type: 'job-request', id: 4, kind: 'teleport', payload: {} },
      post,
    );

    expect(posted).toEqual([
      {
        message: {
          type: 'job-error',
          id: 4,
          failure: {
            code: 'invalid-request',
            name: 'TypeError',
            message: 'The worker received a malformed job request.',
          },
        },
        transfer: [],
      },
    ]);
  });

  it('ignores a message it cannot answer because it has no id', async () => {
    const { post, posted } = createPoster();
    const entry = createWorkerEntry(createDefaultJobHandlers());

    await entry.onMessage({ hello: 'worker' }, post);
    await entry.onMessage(null, post);

    expect(posted).toEqual([]);
  });

  it('answers with a job-error for the same id when the reply cannot be posted', async () => {
    const { post, posted } = createPoster(createDataCloneError());

    await createWorkerEntry(createDefaultJobHandlers()).onMessage(
      createJobRequestMessage(5, 'echo', { message: 'x', bytes: new ArrayBuffer(4) }),
      post,
    );

    expect(posted).toEqual([
      {
        message: {
          type: 'job-error',
          id: 5,
          failure: {
            code: 'handler-failed',
            name: 'DataCloneError',
            message: 'An ArrayBuffer is detached and could not be cloned.',
          },
        },
        transfer: [],
      },
    ]);
  });

  it('reports a request it could not deserialise as a worker fault', () => {
    const { post, posted } = createPoster();

    createWorkerEntry(createDefaultJobHandlers()).onMessageError(post);

    expect(posted).toEqual([
      {
        message: {
          type: 'worker-fault',
          failure: {
            code: 'worker-failed',
            name: 'Error',
            message: 'The job worker received a request it could not deserialise.',
          },
        },
        transfer: [],
      },
    ]);
  });
});
