import { describe, expect, it } from 'vitest';

import { runJob, type JobHandlers } from './job-handlers.js';
import { createJobRequestMessage } from './protocol.js';

// These tests register their own `mesh` handlers, to see what runJob does with any handler.
const meshRequest = createJobRequestMessage(5, 'mesh', {
  objectId: 'path-1',
  version: 1,
  bucket: 2,
  network: { vertices: [], segments: [] },
  strokeWidth: 2,
  isFilled: false,
});

function meshed(objectId: string, vertices = new Float32Array()) {
  return {
    objectId,
    version: 1,
    bucket: 2,
    vertices,
    fillVertexCount: 0,
    strokeVertexCount: vertices.length / 2,
    bounds: null,
  };
}

describe('runJob', () => {
  it('runs the handler for the kind and replies with its response and transfer list', async () => {
    const vertices = new Float32Array([0, 0, 8, 8, 0, 8]);
    const handlers: JobHandlers = {
      mesh: (request) => ({
        response: meshed(request.objectId, vertices),
        transfer: [vertices.buffer],
      }),
    };

    const reply = await runJob(handlers, meshRequest);

    expect(reply.message).toEqual({
      type: 'job-result',
      id: 5,
      payload: meshed('path-1', vertices),
    });
    expect(reply.transfer).toEqual([vertices.buffer]);
  });

  it('awaits an asynchronous handler', async () => {
    const handlers: JobHandlers = {
      mesh: async (request) => {
        await Promise.resolve();
        return { response: meshed(request.objectId), transfer: [] };
      },
    };

    const reply = await runJob(handlers, meshRequest);

    expect(reply.message).toMatchObject({ type: 'job-result', id: 5 });
  });

  it('starts the handler synchronously, so a main-thread drain bounds its synchronous work', () => {
    let hasStarted = false;
    const handlers: JobHandlers = {
      mesh: (request) => {
        hasStarted = true;
        return { response: meshed(request.objectId), transfer: [] };
      },
    };

    void runJob(handlers, meshRequest);

    expect(hasStarted).toBe(true);
  });

  it('replies no-handler when the kind has no registered handler', async () => {
    const reply = await runJob({}, meshRequest);

    expect(reply.message).toEqual({
      type: 'job-error',
      id: 5,
      failure: {
        code: 'no-handler',
        name: 'Error',
        message: 'No handler is registered for "mesh" jobs.',
      },
    });
    expect(reply.transfer).toEqual([]);
  });

  it('replies handler-failed with the error when a handler throws or rejects', async () => {
    const throwing: JobHandlers = {
      mesh: () => {
        throw new RangeError('font missing');
      },
    };
    const rejecting: JobHandlers = { mesh: () => Promise.reject(new Error('wasm crashed')) };

    const thrown = await runJob(throwing, meshRequest);
    const rejected = await runJob(rejecting, meshRequest);

    expect(thrown.message).toEqual({
      type: 'job-error',
      id: 5,
      failure: { code: 'handler-failed', name: 'RangeError', message: 'font missing' },
    });
    expect(rejected.message).toMatchObject({
      failure: { code: 'handler-failed', message: 'wasm crashed' },
    });
  });
});
