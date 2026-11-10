import { describe, expect, it } from 'vitest';

import { callEach, changedStatesOf } from './presence-changes.js';

// Each remote awareness change, as `PresenceChannel.subscribeChanges` tells it.

const mira = {
  principal: { id: 'user-mira', kind: 'user', name: 'Mira', color: '#cc5533' },
  updatedAt: 1,
};

describe('changedStatesOf', () => {
  it('cleans each remote state, leaves out the local client and marks the rest undefined', () => {
    const raw = new Map<number, unknown>([
      [1, mira],
      [2, { principal: 'not a principal' }],
      [9, mira],
    ]);
    const changed = changedStatesOf([1, 2, 3, 9], (clientId) => raw.get(clientId), 9);
    expect([...changed.keys()]).toEqual([1, 2, 3]);
    expect(changed.get(1)?.principal.name).toBe('Mira');
    expect(changed.get(2)).toBeUndefined();
    expect(changed.get(3)).toBeUndefined();
  });
});

describe('callEach', () => {
  it('calls every listener though one throws, and rethrows its error on its own', async () => {
    const seen: number[] = [];
    const failure = new Error('listener failed');
    const errors: unknown[] = [];
    const original = globalThis.queueMicrotask;
    globalThis.queueMicrotask = (task) => {
      try {
        task();
      } catch (error: unknown) {
        errors.push(error);
      }
    };
    try {
      callEach(
        [
          (value: number) => {
            seen.push(value);
            throw failure;
          },
          (value: number) => {
            seen.push(value + 1);
          },
        ],
        1,
      );
    } finally {
      globalThis.queueMicrotask = original;
    }
    await Promise.resolve();
    expect(seen).toEqual([1, 2]);
    expect(errors).toEqual([failure]);
  });
});
