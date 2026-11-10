import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
  INCOMPLETE_UPDATE_CLOSE_CODE,
  INCOMPLETE_UPDATE_REASON,
  OBJECTS_MAP_NAME,
  READABLE_LAYOUT_VERSIONS,
  UNREADABLE_LAYOUT_REASON,
  UNSTAMPED_WRITE_REASON,
  YjsDocumentStore,
} from '@canvas/document';

import { addStickies } from '../cache/__fixtures__/sticky-board.js';

import { ClientHarness } from './__fixtures__/client-harness.js';
import { EDITOR_CLAIMS, unsignedToken } from './__fixtures__/unsigned-token.js';
import { withReadableLayouts } from './relay-close.js';

// A build that cannot read the board: the relay's layout gate refuses it, or its own
// store refuses the relay's data. Either way the client ends `outdated` and never retries (an
// early review saw a version error loop as endless reconnections).

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

/**
 * The layouts a connection declared, from the URL it opened.
 *
 * @param url - The URL.
 * @returns The `layouts` parameter.
 */
function declaredLayouts(url: string | undefined): string | null {
  return new URL(url ?? 'ws://none').searchParams.get('layouts');
}

describe('the readable layouts a client declares', () => {
  it('are its store’s readable layouts by default, or the ones it is given', async () => {
    harness = new ClientHarness();
    await harness.connect();
    await harness.connect({ readableLayoutVersions: [3, 2] });
    expect(declaredLayouts(harness.relay.openedUrls[0])).toBe(READABLE_LAYOUT_VERSIONS.join(','));
    expect(declaredLayouts(harness.relay.openedUrls[1])).toBe('2,3');
  });

  it('replace a layouts parameter the URL already has and keep the others', () => {
    expect(withReadableLayouts('wss://relay.test/sync?layouts=9&region=eu', [1])).toBe(
      'wss://relay.test/sync?layouts=1&region=eu',
    );
  });
});

describe('CollabClient when the build is outdated', () => {
  it('ends outdated on the gate’s close, never reconnects, and keeps local edits unsent', async () => {
    harness = new ClientHarness();
    const { relay } = harness;
    relay.layoutRefusal = UNREADABLE_LAYOUT_REASON;
    const store = new YjsDocumentStore();
    const client = await harness.open({ store });
    addStickies(store, 3);
    relay.run();
    expect(client.status.state).toBe('outdated');
    expect(client.status.rejectionReason).toBe(UNREADABLE_LAYOUT_REASON);
    await harness.advanceAndSettle(120_000);
    expect(relay.openedUrls).toHaveLength(1);
    expect(client.status.state).toBe('outdated');
    expect(client.status.pendingUpdateCount).toBeGreaterThan(0);
    expect(relay.received.map((frame) => frame.kind)).not.toContain('sync-step-2');
    expect(relay.received.map((frame) => frame.kind)).not.toContain('update');
    expect(store.read().objects.size).toBe(3);
  });

  it('ends outdated when the relay closes a connected client for an unstamped write', async () => {
    harness = new ClientHarness();
    const { relay } = harness;
    const client = await harness.connect();
    expect(client.status.state).toBe('connected');
    relay.drop(4426, UNSTAMPED_WRITE_REASON);
    await harness.advanceAndSettle(60_000);
    expect(client.status.state).toBe('outdated');
    expect(client.status.rejectionReason).toBe(UNSTAMPED_WRITE_REASON);
    expect(relay.openedUrls).toHaveLength(1);
  });

  it('ends outdated when the board’s layout rises mid-session, keeping edits in flight', async () => {
    // Another client raised the board's layout: the relay closes this connected reader with the
    // connect-time refusal and does not apply what it sent meanwhile. The same terminal
    // state as at connect time: no reconnection, and the edits stay in the store, pending.
    harness = new ClientHarness();
    const { relay } = harness;
    const store = new YjsDocumentStore();
    const client = await harness.connect({ store });
    expect(client.status.state).toBe('connected');
    addStickies(store, 2);
    const pending = client.status.pendingUpdateCount;
    expect(pending).toBeGreaterThan(0);
    relay.isResponsive = false;
    relay.drop(4426, UNREADABLE_LAYOUT_REASON);
    expect(client.status.state).toBe('outdated');
    expect(client.status.rejectionReason).toBe(UNREADABLE_LAYOUT_REASON);
    addStickies(store, 1, { seed: 2 });
    await harness.advanceAndSettle(120_000);
    expect(client.status.state).toBe('outdated');
    expect(relay.openedUrls).toHaveLength(1);
    expect(relay.doc.getMap(OBJECTS_MAP_NAME).size).toBe(0);
    expect(store.read().objects.size).toBe(3);
    expect(client.status.pendingUpdateCount).toBeGreaterThan(pending);
  });

  it('names the close code when the gate’s close carries no reason', async () => {
    harness = new ClientHarness();
    const client = await harness.connect();
    harness.relay.drop(4426, '');
    expect(client.status.state).toBe('outdated');
    expect(client.status.rejectionReason).toBe('4426');
  });

  it('reads the gate’s reason in a permission-denied answer as outdated, not as a bad token', async () => {
    harness = new ClientHarness();
    const getToken = vi.fn(() => Promise.resolve(unsignedToken(EDITOR_CLAIMS)));
    harness.relay.deniedReason = UNREADABLE_LAYOUT_REASON;
    const client = await harness.open({ getToken });
    await harness.settle();
    expect(client.status.state).toBe('outdated');
    // A refused token is refreshed once; the gate's refusal is not a token problem.
    expect(harness.relay.receivedTokens).toHaveLength(1);
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('turns a DocumentVersionError from the relay’s data into outdated, not an error', async () => {
    harness = new ClientHarness();
    const { relay } = harness;
    // A writer from before: an object and no stamp.
    relay.doc.getMap(OBJECTS_MAP_NAME).set('old-object', new Y.Map([['z', 'a0']]));
    const onError = vi.fn();
    const client = await harness.connect({ onError });
    expect(client.status.state).toBe('outdated');
    expect(client.status.rejectionReason).toBe('unversioned');
    await harness.advanceAndSettle(120_000);
    expect(relay.openedUrls).toHaveLength(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('finds the version error inside an AggregateError when a store listener failed too', async () => {
    harness = new ClientHarness();
    const { relay } = harness;
    relay.doc.getMap(OBJECTS_MAP_NAME).set('old-object', new Y.Map([['z', 'a0']]));
    const store = new YjsDocumentStore();
    store.subscribe(() => {
      throw new Error('a listener failed');
    });
    const onError = vi.fn();
    const client = await harness.connect({ store, onError });
    expect(client.status.state).toBe('outdated');
    expect(client.status.rejectionReason).toBe('unversioned');
    expect(onError).not.toHaveBeenCalled();
  });

  it('stays outdated through disconnect, connect and the network coming back', async () => {
    harness = new ClientHarness();
    const { relay, network } = harness;
    relay.layoutRefusal = UNREADABLE_LAYOUT_REASON;
    const client = await harness.connect();
    client.disconnect();
    client.connect();
    network.set(false);
    network.set(true);
    await harness.advanceAndSettle(60_000);
    expect(client.status.state).toBe('outdated');
    expect(relay.openedUrls).toHaveLength(1);
  });

  it('treats the relay holding back an incomplete update as a lost connection, and retries', async () => {
    harness = new ClientHarness();
    const { relay } = harness;
    const store = new YjsDocumentStore();
    const client = await harness.connect({ store });
    addStickies(store, 1);
    const opened = relay.openedUrls.length;
    relay.drop(INCOMPLETE_UPDATE_CLOSE_CODE, INCOMPLETE_UPDATE_REASON);
    expect(client.status.state).toBe('reconnecting');
    // The first retry's backoff, well within the idle timeout.
    await harness.advanceAndSettle(5_000);
    expect(client.status.state).toBe('connected');
    expect(relay.openedUrls).toHaveLength(opened + 1);
    expect(relay.doc.getMap(OBJECTS_MAP_NAME).size).toBe(1);
  });
});
