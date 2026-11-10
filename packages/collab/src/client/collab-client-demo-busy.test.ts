// The relay turns a demo board visitor away for now with 1013 `demo-busy`. The client
// reports a `DemoBusyNotice`, so the page can tell the visitor, and keeps retrying as for any lost
// connection, never `unauthorized`.
import { afterEach, expect, it } from 'vitest';

import { ClientHarness } from './__fixtures__/client-harness.js';
import { EDITOR_CLAIMS, unsignedToken } from './__fixtures__/unsigned-token.js';
import { DemoBusyNotice } from './demo-busy-notice.js';

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

it('reports demo-busy and keeps retrying', async () => {
  harness = new ClientHarness();
  harness.relay.loadFailure = { code: 1013, reason: 'demo-busy' };
  const errors: unknown[] = [];
  const token = unsignedToken({ ...EDITOR_CLAIMS, principal: 'demo', role: 'viewer' });
  const client = await harness.open({
    getToken: () => Promise.resolve(token),
    onError: (error) => errors.push(error),
  });
  await harness.settle();
  expect(client.status.state).toBe('reconnecting');
  expect(errors.filter((error) => error instanceof DemoBusyNotice)).toHaveLength(1);
  harness.relay.loadFailure = undefined;
  await harness.advanceAndSettle(250);
  expect(client.status.state).toBe('connected');
});

it('reports nothing for another 1013', async () => {
  harness = new ClientHarness();
  harness.relay.loadFailure = { code: 1013, reason: 'storage-unavailable' };
  const errors: unknown[] = [];
  await harness.open({
    getToken: () => Promise.resolve(unsignedToken(EDITOR_CLAIMS)),
    onError: (error) => errors.push(error),
  });
  await harness.settle();
  expect(errors.filter((error) => error instanceof DemoBusyNotice)).toHaveLength(0);
});
