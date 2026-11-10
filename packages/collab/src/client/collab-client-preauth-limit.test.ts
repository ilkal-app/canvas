// A state vector can exceed the relay's pre-authentication frame cap even when every
// object is small. Only the token travels before acceptance; an early 1009 is not a lost edit.
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';

import { isSameBytes } from './__fixtures__/chunking-fixtures.js';
import { BOARD, ClientHarness } from './__fixtures__/client-harness.js';
import { decodeRelayMessage } from './relay-protocol.js';

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

it('waits for authentication before sending a state vector above 64 KiB', async () => {
  harness = new ClientHarness();
  const source = new Y.Doc();
  source.transact(() => {
    for (let index = 0; index < 12_000; index += 1) {
      source.clientID = 1_000_000_000 + index;
      source.getMap('payload').set(String(index), index);
    }
  });
  const store = new YjsDocumentStore();
  store.applyUpdate(Y.encodeStateAsUpdate(source), SYSTEM_ORIGIN);
  source.destroy();
  expect(store.encodeStateVector().byteLength).toBeGreaterThan(64 * 1024);
  let isAuthenticated = false;
  const beforeAuth: Uint8Array[] = [];
  const client = await harness.connect({
    store,
    socketFactory: (url, handlers) => {
      const socket = harness.relay.socketFactory(url, {
        ...handlers,
        onMessage: (data) => {
          if (decodeRelayMessage(data, BOARD).kind === 'authenticated') isAuthenticated = true;
          handlers.onMessage(data);
        },
      });
      return {
        send: (data) => {
          if (!isAuthenticated) beforeAuth.push(data);
          socket.send(data);
        },
        close: () => {
          socket.close();
        },
      };
    },
  });
  expect(beforeAuth).toHaveLength(1);
  expect(beforeAuth[0]?.byteLength).toBeLessThan(64 * 1024);
  expect(harness.relay.received.find(({ kind }) => kind === 'sync-step-1')?.size).toBeGreaterThan(
    64 * 1024,
  );
  expect(client.status.state).toBe('connected');
  expect(isSameBytes(Y.encodeStateVector(harness.relay.doc), store.encodeStateVector())).toBe(true);
});

it('backs off after a pre-authentication 1009 and syncs after the next acceptance', async () => {
  harness = new ClientHarness();
  harness.relay.loadFailure = { code: 1009, reason: 'frame-too-large' };
  const client = await harness.connect();
  expect(client.status.state).toBe('reconnecting');
  expect(client.status.rejectionReason).toBeUndefined();
  expect(harness.relay.openedUrls).toHaveLength(1);
  harness.advance(249);
  expect(harness.relay.openedUrls).toHaveLength(1);
  harness.relay.loadFailure = undefined;
  harness.advance(1);
  expect(harness.relay.openedUrls).toHaveLength(2);
  expect(client.status.state).toBe('connected');
});
