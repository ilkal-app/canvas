import { expect, it } from 'vitest';

import { ReactionChannel } from '../presence/reaction-channel.js';

import { ClientHarness } from './__fixtures__/client-harness.js';

// A client given a reaction channel sends its drops as stateless reactions on its
// connection once the relay accepted the token, and stops once it disconnects.

it('sends a drop on the authenticated connection, and nothing once disconnected', async () => {
  const harness = new ClientHarness();
  try {
    const reactions = new ReactionChannel();
    const client = await harness.connect({ reactions });
    await harness.settle();
    const drop = { emoji: '❤️', x: 3, y: 4, pageId: 'page-1' } as const;
    expect(reactions.send(drop)).toBe(true);
    harness.relay.run();
    expect(harness.relay.reactions).toEqual([{ type: 'reaction', ...drop }]);
    client.disconnect();
    expect(reactions.send(drop)).toBe(false);
    harness.relay.run();
    expect(harness.relay.reactions).toHaveLength(1);
  } finally {
    harness.destroy();
  }
});
