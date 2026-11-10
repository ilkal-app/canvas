import { afterEach, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { linkAwareness } from './__fixtures__/awareness-link.js';
import { ManualTime } from './__fixtures__/manual-time.js';
import { PresenceChannel } from './presence-channel.js';
import { MAX_PRESENCE_WRITER_CLIENT_IDS } from './presence-limits.js';
import { writerClientIdsOf } from './presence-sanitize.js';
import type { PresenceUpdate } from './presence-state.js';

// The relay-stamped `writerClientIds` as presence carries it: a peer's list reaches
// the snapshot, kept to Yjs client ids and bounded; the local state never carries one.

const principal = { id: 'user-mira', kind: 'user', name: 'Mira', color: '#cc5533' };
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
 * Opens a receiver and sends it one raw state from a peer, as the relay forwards it.
 *
 * @param state - What the peer's awareness holds.
 * @returns The receiver's channel.
 */
function receive(state: unknown): PresenceChannel {
  const time = new ManualTime();
  const peer = createAwareness();
  const receiver = createAwareness();
  linkAwareness(peer, receiver, () => time.now());
  const channel = new PresenceChannel({
    awareness: receiver,
    principal: { id: 'me', kind: 'user', name: 'Me' },
    clock: time,
    scheduler: time,
  });
  peer.setLocalState(state as Record<string, unknown>);
  time.advanceBy(100);
  return channel;
}

describe('a peer`s writer client ids', () => {
  it('reach the snapshot as the relay stamped them', () => {
    const channel = receive({ principal, updatedAt: 0, writerClientIds: [77, 2 ** 32 - 1] });
    const [peer] = [...channel.getRemote().values()];
    expect(peer === undefined ? undefined : writerClientIdsOf(peer)).toEqual([77, 2 ** 32 - 1]);
    channel.destroy();
  });

  it('keep only Yjs client ids, each once, at most the bound, and the peer', () => {
    const many = [...Array(MAX_PRESENCE_WRITER_CLIENT_IDS + 5).keys()].map((id) => id + 100);
    const channel = receive({
      principal,
      updatedAt: 0,
      writerClientIds: [-1, 1.5, '7', null, 2 ** 32, 100, 100, ...many],
    });
    const [peer] = [...channel.getRemote().values()];
    expect(peer === undefined ? undefined : writerClientIdsOf(peer)).toEqual(
      many.slice(0, MAX_PRESENCE_WRITER_CLIENT_IDS),
    );
    channel.destroy();
  });

  it('are left out when they are not a list, the peer kept', () => {
    const channel = receive({ principal, updatedAt: 0, writerClientIds: { 0: 77 } });
    const [peer] = [...channel.getRemote().values()];
    expect(peer?.principal.id).toBe('user-mira');
    expect(peer !== undefined && 'writerClientIds' in peer).toBe(false);
    expect(peer === undefined ? undefined : writerClientIdsOf(peer)).toEqual([]);
    channel.destroy();
  });

  it('come with whether the name is signed, kept only as a boolean (review)', () => {
    const signed = receive({ principal, updatedAt: 0, isNameSigned: true });
    expect([...signed.getRemote().values()][0]).toMatchObject({ isNameSigned: true });
    signed.destroy();
    const odd = receive({ principal, updatedAt: 0, isNameSigned: 'yes' });
    expect([...odd.getRemote().values()][0]).not.toHaveProperty('isNameSigned');
    odd.destroy();
  });

  it('are never part of the local state, whatever a caller passes', () => {
    const time = new ManualTime();
    const awareness = createAwareness();
    const channel = new PresenceChannel({
      awareness,
      principal: { id: 'me', kind: 'user', name: 'Me' },
      clock: time,
      scheduler: time,
    });
    channel.setLocal({ cursor: { x: 1, y: 2 }, writerClientIds: [77] } as PresenceUpdate);
    time.advanceBy(100);
    expect(awareness.getLocalState()).not.toHaveProperty('writerClientIds');
    expect(channel.getLocal()).not.toHaveProperty('writerClientIds');
    channel.destroy();
  });
});
