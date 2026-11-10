import { afterEach, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { linkAwareness } from './__fixtures__/awareness-link.js';
import { ManualTime } from './__fixtures__/manual-time.js';
import { trackOperatedWriters } from './operated-writers.js';
import { PresenceChannel } from './presence-channel.js';

// The tracker through a real `PresenceChannel`, which folds every awareness change that
// arrives before its next inbound flush into one snapshot. The relay sends a restamp and a
// departure as separate awareness messages; the tracker sees each, though one flush holds both.

const docs: Y.Doc[] = [];

afterEach(() => {
  for (const doc of docs.splice(0)) doc.destroy();
});

/**
 * A fresh awareness instance.
 *
 * @returns The awareness.
 */
function createAwareness(): Awareness {
  const doc = new Y.Doc();
  docs.push(doc);
  return new Awareness(doc);
}

/**
 * Ada's channel, and an agent she operates whose awareness the relay forwards to her.
 *
 * @returns The channel, the agent's awareness and its stamp setter, and the test clock.
 */
function board() {
  const time = new ManualTime();
  const agent = createAwareness();
  const ada = createAwareness();
  linkAwareness(agent, ada, () => time.now());
  const channel = new PresenceChannel({
    awareness: ada,
    principal: { id: 'user-ada', kind: 'user', name: 'Ada' },
    clock: time,
    scheduler: time,
  });
  const stamp = (writerClientIds: readonly number[]): void => {
    agent.setLocalState({
      principal: {
        id: 'connect:app',
        kind: 'agent',
        name: 'Claude',
        color: '#112233',
        operatorId: 'ada',
      },
      updatedAt: time.now(),
      writerClientIds,
    });
  };
  return { time, agent, ada, channel, stamp };
}

describe('operated writers through a real presence channel', () => {
  it('forgets an id the relay restamped away though its agent left in the same flush', () => {
    const { time, agent, channel, stamp } = board();
    stamp([agent.clientID]);
    time.advanceBy(1);
    const writers = trackOperatedWriters(channel, 'ada', () => true);
    expect(writers.owns(agent.clientID)).toBe(true);
    // Another connection wrote under the id: the relay restamps the agent without it, and the
    // agent leaves before Ada's next flush.
    stamp([]);
    agent.setLocalState(null);
    time.advanceBy(1);
    expect(writers.owns(agent.clientID)).toBe(false);
    writers.destroy?.();
    channel.destroy();
  });

  it('remembers a stamp that arrived in the same flush as its agent leaving', () => {
    const { time, agent, channel, stamp } = board();
    stamp([]);
    time.advanceBy(1);
    const writers = trackOperatedWriters(channel, 'ada', () => true);
    expect(writers.records(agent.clientID)).toBe(true);
    stamp([agent.clientID]);
    agent.setLocalState(null);
    time.advanceBy(1);
    expect(writers.owns(agent.clientID)).toBe(true);
    writers.destroy?.();
    channel.destroy();
  });

  it('forgets an id someone else is stamped with, though both left in the same flush', () => {
    const { time, agent, channel, stamp, ada } = board();
    stamp([agent.clientID]);
    time.advanceBy(1);
    const writers = trackOperatedWriters(channel, 'ada', () => true);
    expect(writers.owns(agent.clientID)).toBe(true);
    const mira = createAwareness();
    linkAwareness(mira, ada, () => time.now());
    mira.setLocalState({
      principal: { id: 'user-mira', kind: 'user', name: 'Mira', color: '#cc5533' },
      updatedAt: time.now(),
      writerClientIds: [agent.clientID],
    });
    mira.setLocalState(null);
    agent.setLocalState(null);
    time.advanceBy(1);
    expect(writers.owns(agent.clientID)).toBe(false);
    writers.destroy?.();
    channel.destroy();
  });

  it('watches each change only while an id awaits its stamp or is remembered', () => {
    const { time, agent, channel, stamp } = board();
    stamp([agent.clientID]);
    time.advanceBy(1);
    const writers = trackOperatedWriters(channel, 'ada', () => true);
    expect(writers.owns(agent.clientID)).toBe(true);
    stamp([]);
    time.advanceBy(1);
    expect(writers.owns(agent.clientID)).toBeUndefined();
    agent.setLocalState(null);
    time.advanceBy(1);
    expect(writers.owns(agent.clientID)).toBe(false);
    channel.destroy();
  });
});
