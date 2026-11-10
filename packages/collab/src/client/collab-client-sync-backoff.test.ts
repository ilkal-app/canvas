import { afterEach, expect, it } from 'vitest';

import { ClientHarness } from './__fixtures__/client-harness.js';
import { decodeRelayMessage } from './relay-protocol.js';

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

it.each(['too-many-clients', 'incomplete-update'])(
  'backs off after inbound sync when its own step 2 is repeatedly refused: %s',
  async (reason) => {
    harness = new ClientHarness();
    const { relay, time } = harness;
    const attempts: number[] = [];
    let isRefusing = true;
    const client = await harness.connect({
      reconnect: { maxDelayMs: 1_000 },
      socketFactory: (url, handlers) => {
        attempts.push(time.now());
        return relay.socketFactory(url, {
          ...handlers,
          onMessage: (data) => {
            if (isRefusing && decodeRelayMessage(data, 'board-1').kind === 'sync-status') {
              relay.drop(4425, reason);
            } else handlers.onMessage(data);
          },
        });
      },
    });
    for (let elapsed = 0; elapsed < 4_000; elapsed += 50) harness.advance(50);
    expect(client.status.state).toBe('reconnecting');
    expect(attempts).toEqual([0, 250, 750, 1_750, 2_750, 3_750]);
    isRefusing = false;
    harness.advance(750);
    expect(client.status.state).toBe('connected');
    relay.drop();
    harness.advance(249);
    expect(client.status.state).toBe('reconnecting');
    harness.advance(1);
    expect(client.status.state).toBe('connected');
  },
);

it('resets after read-only inbound sync without requiring accepted writes', async () => {
  harness = new ClientHarness();
  const { relay } = harness;
  relay.isReadOnly = true;
  const client = await harness.connect();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    relay.drop();
    harness.advance(249);
    expect(client.status.state).toBe('reconnecting');
    harness.advance(1);
    expect(client.status.state).toBe('connected');
  }
});
