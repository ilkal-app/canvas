import { describe, expect, it } from 'vitest';

import { trackOperatedWriters, writersOperatedBy } from './operated-writers.js';
import { sanitizePresenceState } from './presence-sanitize.js';
import type { PresenceSnapshot, PresenceState, WriterStampedPresence } from './presence-state.js';

// Which Yjs client ids write for agents a user operates, from relay-stamped presence.

/**
 * A remote presence state as the relay forwards it.
 *
 * @param principal - Its principal's id, kind and operator.
 * @param principal.id - The id.
 * @param principal.kind - The kind.
 * @param principal.operatorId - An agent's operator.
 * @param writerClientIds - The writer ids the relay vouches for.
 * @returns The cleaned state.
 */
function stateOf(
  principal: {
    readonly id: string;
    readonly kind: 'user' | 'agent';
    readonly operatorId?: unknown;
  },
  writerClientIds: readonly number[] = [],
): PresenceState {
  const raw = {
    principal: { name: principal.id, color: '#112233', ...principal },
    updatedAt: 1,
    writerClientIds,
  } as unknown as PresenceState & WriterStampedPresence;
  return sanitizePresenceState(raw);
}

describe('writersOperatedBy', () => {
  it("vouches an operator's agents' stamped ids, and names unstamped agents' awareness ids", () => {
    const presence: PresenceSnapshot = new Map([
      [11, stateOf({ id: 'scout', kind: 'agent', operatorId: 'ada' }, [11, 12])],
      [21, stateOf({ id: 'echo', kind: 'agent', operatorId: 'ada' })],
      [31, stateOf({ id: 'pilot', kind: 'agent', operatorId: 'bob' }, [31])],
      [41, stateOf({ id: 'mira', kind: 'user' }, [41])],
    ]);
    const ada = writersOperatedBy(presence, 'ada');
    expect([...ada.vouched]).toEqual([
      [11, 'scout'],
      [12, 'scout'],
    ]);
    expect([...ada.unstamped]).toEqual([21]);
    expect([...ada.agents]).toEqual(['scout', 'echo']);
    expect([...writersOperatedBy(presence, 'bob').vouched.keys()]).toEqual([31]);
    expect(writersOperatedBy(presence, 'mira')).toEqual({
      vouched: new Map(),
      unstamped: new Set(),
      agents: new Set(),
    });
  });

  it('names no awareness id of an agent whose stamp lists other ids', () => {
    const presence: PresenceSnapshot = new Map([
      [11, stateOf({ id: 'scout', kind: 'agent', operatorId: 'ada' }, [12])],
    ]);
    const { vouched, unstamped } = writersOperatedBy(presence, 'ada');
    expect([...vouched.keys()]).toEqual([12]);
    expect(unstamped.size).toBe(0);
  });

  it('leaves out an id another present client was vouched for', () => {
    const presence: PresenceSnapshot = new Map([
      [11, stateOf({ id: 'scout', kind: 'agent', operatorId: 'ada' }, [11, 12])],
      [41, stateOf({ id: 'mira', kind: 'user' }, [11])],
    ]);
    expect([...writersOperatedBy(presence, 'ada').vouched.keys()]).toEqual([12]);
  });

  it('keeps an operator only on an agent, as a short string, when presence is cleaned', () => {
    expect(stateOf({ id: 'mira', kind: 'user', operatorId: 'ada' }).principal).not.toHaveProperty(
      'operatorId',
    );
    for (const operatorId of ['', 'a'.repeat(257), 7]) {
      const { principal } = stateOf({ id: 'scout', kind: 'agent', operatorId });
      expect(principal, String(operatorId)).not.toHaveProperty('operatorId');
    }
    expect(stateOf({ id: 'scout', kind: 'agent', operatorId: 'ada' }).principal).toMatchObject({
      operatorId: 'ada',
    });
  });
});

/**
 * Presence a test changes, telling its listeners as a client's channel does.
 *
 * @returns The source, a setter and its listener count.
 */
function presenceSource() {
  let snapshot: PresenceSnapshot = new Map();
  const listeners = new Set<() => void>();
  return {
    getRemote: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next: PresenceSnapshot) => {
      snapshot = next;
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

const scout = (writers: readonly number[] = []) =>
  stateOf({ id: 'scout', kind: 'agent', operatorId: 'ada' }, writers);

// The stamp is remembered as it arrives, by the presence that listed it.
describe('trackOperatedWriters', () => {
  it('records nothing while not connected, and never an id no agent of the user holds', () => {
    const presence = presenceSource();
    presence.set(new Map([[11, scout([11])]]));
    let isConnected = false;
    const writers = trackOperatedWriters(presence, 'ada', () => isConnected);
    expect(writers.records(11)).toBe(false);
    isConnected = true;
    expect([11, 12].map((id) => writers.records(id))).toEqual([true, false]);
    // Watched while 11 is remembered.
    expect(presence.listenerCount()).toBe(1);
  });

  it('watches presence while a recorded id awaits its stamp or is remembered', () => {
    const presence = presenceSource();
    presence.set(new Map([[21, scout()]]));
    const writers = trackOperatedWriters(presence, 'ada', () => true);
    expect(presence.listenerCount()).toBe(0);
    expect(writers.records(21)).toBe(true);
    expect(writers.records(21)).toBe(true);
    expect(presence.listenerCount()).toBe(1);
    presence.set(new Map([[21, scout([21])]]));
    presence.set(new Map());
    expect(presence.listenerCount()).toBe(1);
    expect(writers.owns(21)).toBe(true);
    // An agent that leaves before its stamp is never known to be the user's.
    presence.set(new Map([[22, scout()]]));
    expect(writers.records(22)).toBe(true);
    presence.set(new Map());
    expect(writers.owns(22)).toBe(false);
    // One its stamp drops is forgotten: nothing is left to watch.
    presence.set(new Map([[21, scout([])]]));
    expect(presence.listenerCount()).toBe(0);
  });

  it('forgets an id its holder drops, or whose awareness id someone else holds now', () => {
    const presence = presenceSource();
    presence.set(new Map([[11, scout([11, 12])]]));
    const writers = trackOperatedWriters(presence, 'ada', () => true);
    expect([11, 12].map((id) => writers.owns(id))).toEqual([true, true]);
    presence.set(new Map([[11, scout([11])]]));
    expect(writers.owns(12)).toBe(false);
    presence.set(new Map([[11, stateOf({ id: 'mira', kind: 'user' })]]));
    expect(writers.owns(11)).toBe(false);
  });

  it('never owns an id the relay restamped away to an empty stamp, after its holder leaves', () => {
    const presence = presenceSource();
    presence.set(
      new Map([
        [11, scout([11])],
        [21, scout([31])],
      ]),
    );
    const writers = trackOperatedWriters(presence, 'ada', () => true);
    expect([11, 31].map((id) => writers.owns(id))).toEqual([true, true]);
    // Another connection wrote under both ids: the relay leaves each holder's stamp empty.
    presence.set(
      new Map([
        [11, scout([])],
        [21, scout([])],
      ]),
    );
    expect(writers.owns(31)).toBe(false);
    presence.set(new Map());
    expect([11, 31].map((id) => writers.owns(id))).toEqual([false, false]);
  });

  it('never owns an id the relay restamped away while no one asked, after its holder leaves', () => {
    const presence = presenceSource();
    presence.set(new Map([[21, scout([31])]]));
    const writers = trackOperatedWriters(presence, 'ada', () => true);
    expect(writers.owns(31)).toBe(true);
    // Contested, then gone, with no question between.
    presence.set(new Map([[21, scout([])]]));
    presence.set(new Map());
    expect(writers.owns(31)).toBe(false);
  });

  it('stops watching presence when destroyed', () => {
    const presence = presenceSource();
    presence.set(new Map([[21, scout()]]));
    const writers = trackOperatedWriters(presence, 'ada', () => true);
    expect(writers.records(21)).toBe(true);
    expect(presence.listenerCount()).toBe(1);
    writers.destroy?.();
    expect(presence.listenerCount()).toBe(0);
  });
});
