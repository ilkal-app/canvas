import { describe, expect, it } from 'vitest';

import { writersOperatedBy } from './operated-writers.js';
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
