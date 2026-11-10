import { describe, expect, it } from 'vitest';

import { deserializeStickyAuthors, serializeStickyAuthors, type StickyAuthors } from '../index.js';

import { FakeCanvas } from './__fixtures__/fake-host-platform.js';
import { InMemoryEngineWorker, settle } from './__fixtures__/in-memory-engine-worker.js';
import { isHostToWorkerMessage } from './host-protocol.js';
import { WorkerEngineHost } from './worker-engine-host.js';

const AUTHORS: StickyAuthors = {
  isShown: true,
  names: new Map([
    ['user:ada', 'Ada'],
    ['user:lin', 'Lin'],
  ]),
  fallback: 'Former member',
};

describe('sticky author host messages', () => {
  it('round-trips the ordered, structured-cloneable principal/name pairs', () => {
    const serialized = serializeStickyAuthors(AUTHORS);
    expect(serialized).toEqual({
      isShown: true,
      names: [
        ['user:ada', 'Ada'],
        ['user:lin', 'Lin'],
      ],
      fallback: 'Former member',
    });
    expect(deserializeStickyAuthors(structuredClone(serialized))).toEqual(AUTHORS);
  });

  it('accepts the command and rejects malformed name pairs', () => {
    expect(
      isHostToWorkerMessage({
        type: 'engine-commands',
        commands: [{ type: 'stickyAuthors', ...serializeStickyAuthors(AUTHORS) }],
      }),
    ).toBe(true);
    for (const names of [[['user:ada']], [['user:ada', 42]], 'Ada']) {
      expect(
        isHostToWorkerMessage({
          type: 'engine-commands',
          commands: [{ type: 'stickyAuthors', isShown: true, names, fallback: 'Former member' }],
        }),
      ).toBe(false);
    }
  });

  it('sends the complete names through a worker host and the worker handles them', async () => {
    const worker = new InMemoryEngineWorker();
    const created = WorkerEngineHost.create(worker, new FakeCanvas(4, 2), 1_000_000, {});
    await settle();
    const host = await created;
    const faults: Error[] = [];
    host.onFault((error) => faults.push(error));
    host.setStickyAuthors(AUTHORS);
    await settle();
    expect(worker.received.at(-1)).toEqual({
      type: 'engine-commands',
      commands: [{ type: 'stickyAuthors', ...serializeStickyAuthors(AUTHORS) }],
    });
    await worker.runFrame(0);
    expect(faults).toEqual([]);
    host.destroy();
  });
});
