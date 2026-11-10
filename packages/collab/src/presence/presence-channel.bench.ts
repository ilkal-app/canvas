import { afterAll, bench, describe } from 'vitest';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { ManualTime } from './__fixtures__/manual-time.js';
import { applyChangedClients } from './inbound-coalescing.js';
import { PresenceChannel } from './presence-channel.js';
import type { PresenceSnapshot, PresenceState } from './presence-state.js';

// Remote presence must not cost frames. Fifty collaborators at 25 Hz is
// one message per client every 40 ms tick; the channel folds each tick into one snapshot.
const CLIENT_COUNT = 50;

const docs: Y.Doc[] = [];
function createAwareness(): Awareness {
  const doc = new Y.Doc();
  docs.push(doc);
  return new Awareness(doc);
}

function presenceOf(index: number, tick: number): PresenceState {
  return {
    principal: {
      id: `user-${String(index)}`,
      kind: 'user',
      name: `User ${String(index)}`,
      color: '#0090ff',
    },
    cursor: { x: index * 10 + tick, y: tick },
    selection: [`note-${String(index)}`],
    viewport: { x: tick, y: 0, w: 1440, h: 900, zoom: 1 },
    updatedAt: tick,
  };
}

const time = new ManualTime();
const receiver = createAwareness();
const channel = new PresenceChannel({
  awareness: receiver,
  principal: { id: 'me', kind: 'user', name: 'Me' },
  clock: time,
  scheduler: time,
});
// A listener, so each tick pays for the notification the renderer would receive.
channel.subscribe(() => undefined);
const senders = Array.from({ length: CLIENT_COUNT }, () => createAwareness());
let tick = 0;

// Two alternating tick states, so every coalescing run replaces all fifty entries.
const senderIndexes = [...Array(CLIENT_COUNT).keys()];
const coalesceTicks = [0, 1].map(
  (tickIndex) =>
    new Map<number, PresenceState>(
      senderIndexes.map((index) => [index + 1, presenceOf(index, tickIndex)]),
    ),
);
const clientIds = senderIndexes.map((index) => index + 1);
let coalesceSnapshot: PresenceSnapshot = new Map();
let coalesceRun = 0;

afterAll(() => {
  channel.destroy();
  for (const doc of docs.splice(0)) {
    doc.destroy();
  }
});

describe('presence inbound, 50 clients at 25 Hz', () => {
  bench('one 40 ms tick: 50 encoded updates applied and coalesced into one snapshot', () => {
    tick += 1;
    senders.forEach((sender, index) => {
      sender.setLocalState(presenceOf(index, tick));
      applyAwarenessUpdate(receiver, encodeAwarenessUpdate(sender, [sender.clientID]), 'relay');
    });
    time.advanceBy(40);
  });

  bench('coalescing alone: 50 changed clients folded into a snapshot', () => {
    coalesceRun += 1;
    const states = coalesceTicks[coalesceRun % 2];
    coalesceSnapshot = applyChangedClients(
      coalesceSnapshot,
      clientIds,
      (clientId) => states?.get(clientId),
      0,
    );
  });
});
