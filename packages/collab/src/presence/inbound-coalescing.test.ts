import { describe, expect, it } from 'vitest';

import { applyChangedClients } from './inbound-coalescing.js';
import { sanitizePresenceState } from './presence-sanitize.js';
import type { PresenceSnapshot, PresenceState } from './presence-state.js';

function presence(id: string, x: number): PresenceState {
  return {
    principal: { id, kind: 'user', name: id, color: '#1f77b4' },
    cursor: { x, y: 0 },
    updatedAt: 0,
  };
}

describe('applyChangedClients', () => {
  const local = 1;
  const alice = presence('alice', 1);
  const bob = presence('bob', 2);
  const empty: PresenceSnapshot = new Map();

  it('adds valid remote states and skips the local client', () => {
    const states = new Map<number, unknown>([
      [1, presence('me', 0)],
      [2, alice],
      [3, bob],
    ]);

    const next = applyChangedClients(empty, [1, 2, 3], (id) => states.get(id), local);

    expect([...next.entries()]).toEqual([
      [2, alice],
      [3, bob],
    ]);
  });

  it('drops clients whose state is gone or is not presence', () => {
    const previous: PresenceSnapshot = new Map([
      [2, alice],
      [3, bob],
    ]);
    const states = new Map<number, unknown>([[3, {}]]);

    const next = applyChangedClients(previous, [2, 3], (id) => states.get(id), local);

    expect(next.size).toBe(0);
  });

  it('returns the same snapshot when nothing it holds changed', () => {
    // The snapshot holds the cleaned form of the state the awareness holds.
    const previous: PresenceSnapshot = new Map([[2, sanitizePresenceState(alice)]]);
    const states = new Map<number, unknown>([[2, alice]]);

    expect(applyChangedClients(previous, [2, 1], (id) => states.get(id), local)).toBe(previous);
    expect(applyChangedClients(previous, [], (id) => states.get(id), local)).toBe(previous);
  });

  it('builds a new snapshot and never mutates the previous one', () => {
    const previous: PresenceSnapshot = new Map([[2, alice]]);
    const moved = presence('alice', 9);
    const states = new Map<number, unknown>([[2, moved]]);

    const next = applyChangedClients(previous, [2], (id) => states.get(id), local);

    expect(next).not.toBe(previous);
    expect(next.get(2)).toEqual(moved);
    expect(previous.get(2)).toBe(alice);
  });
});
