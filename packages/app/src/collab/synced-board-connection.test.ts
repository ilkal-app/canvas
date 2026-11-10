import { describe, expect, it, vi } from 'vitest';

import { CacheWriteTracker, type BoardTokenRole } from '@canvas/collab';
import { YjsDocumentStore } from '@canvas/document';

import { FakeCarryOver } from './__fixtures__/fake-earlier-layouts.js';
import { FakeSyncClient } from './__fixtures__/fake-sync-client.js';
import { SyncedBoardConnection } from './synced-board-connection.js';
import { userOriginFromClaims } from './user-origin.js';

const EDITS = {
  boardId: 'board-1',
  source: 'canvas-board-cache:layout:2',
  fromLayoutVersion: 2,
  toLayoutVersion: 3,
  unsentChangeCount: 2,
};

/**
 * A synced connection over a fake client.
 *
 * @param carryOver - The client's layout carry-over, if any.
 * @param role - The first token's role; an editor's if absent.
 * @returns The connection and its client.
 */
function connect(
  carryOver?: FakeCarryOver,
  role: BoardTokenRole = 'editor',
): {
  connection: SyncedBoardConnection;
  client: FakeSyncClient;
} {
  const store = new YjsDocumentStore();
  const client = new FakeSyncClient(
    { store, boardId: 'board-1', url: 'ws://relay.test' },
    true,
    role,
  );
  client.layoutCarryOver = carryOver;
  const connection = new SyncedBoardConnection(store, client, userOriginFromClaims(client.claims));
  return { connection, client };
}

describe('SyncedBoardConnection stranded edits', () => {
  it('shows what the layout carry-over stranded, follows it, and dismisses through it', async () => {
    const carryOver = new FakeCarryOver();
    const { connection } = connect(carryOver);
    expect(connection.status().strandedEdits).toEqual([]);
    const listener = vi.fn();
    connection.subscribe(listener);
    carryOver.set([EDITS]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(connection.status().strandedEdits).toEqual([EDITS]);
    connection.dismissStrandedEdits('canvas-board-cache:layout:2');
    await Promise.resolve();
    expect(carryOver.dismissed).toEqual(['canvas-board-cache:layout:2']);
    expect(connection.status().strandedEdits).toEqual([]);
    connection.destroy();
    carryOver.set([EDITS]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("exposes the client's cache writes", () => {
    const { connection, client } = connect();
    expect(connection.cacheWrites).toBeUndefined();
    const cacheWrites = new CacheWriteTracker();
    Object.assign(client, { cacheWrites });
    expect(connection.cacheWrites).toBe(cacheWrites);
    connection.destroy();
  });

  it('has none, and dismisses nothing, for a client without a carry-over', () => {
    const { connection } = connect();
    expect(connection.status().strandedEdits).toEqual([]);
    connection.dismissStrandedEdits('canvas-board-cache:layout:2');
    connection.destroy();
  });
});

describe('SyncedBoardConnection read-only', () => {
  it('takes the first token’s role until the relay answers: a viewer and a commenter only look', () => {
    expect(connect(undefined, 'viewer').connection.status().isReadOnly).toBe(true);
    expect(connect(undefined, 'commenter').connection.status().isReadOnly).toBe(true);
    expect(connect(undefined, 'editor').connection.status().isReadOnly).toBe(false);
    expect(connect(undefined, 'owner').connection.status().isReadOnly).toBe(false);
  });

  it('keeps the token’s role while offline, before any answer', () => {
    const { connection, client } = connect(undefined, 'viewer');
    client.moveTo('offline');
    expect(connection.status().isReadOnly).toBe(true);
  });

  it('follows the relay’s answer once it has connected: an upgrade and a downgrade mid-session', () => {
    const { connection, client } = connect(undefined, 'viewer');
    client.answer(true);
    client.moveTo('connected');
    expect(connection.status().isReadOnly).toBe(true);
    const listener = vi.fn();
    connection.subscribe(listener);
    // The owner made them an editor: the relay closed the connection (4403) and re-admitted them.
    client.moveTo('reconnecting');
    expect(connection.status().isReadOnly).toBe(true);
    client.answer(false);
    expect(connection.status().isReadOnly).toBe(false);
    client.moveTo('connected');
    expect(listener).toHaveBeenCalledTimes(3);
    // And back to a viewer.
    client.moveTo('reconnecting');
    client.answer(true);
    expect(connection.status().isReadOnly).toBe(true);
  });
});

describe('SyncedBoardConnection Retry now', () => {
  it('reconnects at once: the client goes offline on purpose and comes back', () => {
    const { connection, client } = connect();
    const calls: string[] = [];
    Object.assign(client, {
      disconnect: () => calls.push('disconnect'),
      connect: () => calls.push('connect'),
    });
    client.moveTo('reconnecting');
    connection.retryNow();
    expect(calls).toEqual(['disconnect', 'connect']);
  });

  it('does nothing for a client that cannot reconnect on request', () => {
    const { connection, client } = connect();
    client.moveTo('reconnecting');
    expect(() => {
      connection.retryNow();
    }).not.toThrow();
    expect(connection.status().state).toBe('reconnecting');
  });
});

describe('SyncedBoardConnection page in presence', () => {
  it('tells collaborators the page shown when the presence channel takes a local state', () => {
    const { connection, client } = connect();
    connection.showPage('page-1');
    const setLocal = vi.fn();
    Object.assign(client.presence ?? {}, { setLocal });
    connection.showPage('p2');
    expect(setLocal).toHaveBeenCalledWith({ page: 'p2' });
    connection.destroy();
  });
});

describe('SyncedBoardConnection editing in presence', () => {
  it('shares the text edited and its end, when the presence channel takes a local state', () => {
    const { connection, client } = connect();
    connection.showEditing({ objectId: 'note-1', anchor: 1, focus: 3 });
    const setLocal = vi.fn();
    Object.assign(client.presence ?? {}, { setLocal });
    connection.showEditing({ objectId: 'note-1', anchor: 1, focus: 3 });
    connection.showEditing(null);
    expect(setLocal.mock.calls).toEqual([
      [{ editing: { objectId: 'note-1', anchor: 1, focus: 3 } }],
      [{ editing: null }],
    ]);
    connection.destroy();
  });
});

describe('SyncedBoardConnection follow and spotlight in presence', () => {
  it('shares the spotlight and whom the person follows, and clears them', () => {
    const { connection, client } = connect();
    const setLocal = vi.fn();
    Object.assign(client.presence ?? {}, { setLocal });
    connection.showSpotlight({ startedAt: 7 });
    connection.showFollowing('ana');
    connection.showSpotlight(null);
    connection.showFollowing(null);
    expect(setLocal.mock.calls).toEqual([
      [{ spotlight: { startedAt: 7 } }],
      [{ following: 'ana' }],
      [{ spotlight: null }],
      [{ following: null }],
    ]);
    connection.destroy();
  });
  it('reads its own client and presence, or nothing before the channel has them', () => {
    const { connection, client } = connect();
    Object.assign(client.presence ?? {}, { getLocal: undefined });
    expect(connection.localPresence()).toBeUndefined();
    const state = { principal: { id: 'me', kind: 'user', name: 'Me', color: '#000000' } };
    Object.assign(client.presence ?? {}, { getLocal: () => state, clientId: 4 });
    expect(connection.localPresence()).toEqual({ clientId: 4, state });
    connection.destroy();
  });
});

describe('SyncedBoardConnection viewport in presence', () => {
  it('shares the view shown, or none, when the presence channel takes a local state', () => {
    const { connection, client } = connect();
    const viewport = { x: 1, y: 2, w: 300, h: 200, zoom: 2 };
    connection.showViewport(viewport);
    const setLocal = vi.fn();
    Object.assign(client.presence ?? {}, { setLocal });
    connection.showViewport(viewport);
    connection.showViewport(null);
    expect(setLocal.mock.calls).toEqual([[{ viewport }], [{ viewport: null }]]);
    connection.destroy();
  });

  it('shares the pointer, or none, when the presence channel takes a local state', () => {
    const { connection, client } = connect();
    const cursor = { x: 12, y: -4 };
    connection.showCursor(cursor);
    const setLocal = vi.fn();
    Object.assign(client.presence ?? {}, { setLocal });
    connection.showCursor(cursor);
    connection.showCursor(null);
    expect(setLocal.mock.calls).toEqual([[{ cursor }], [{ cursor: null }]]);
    connection.destroy();
  });

  it('shares the selection as ids, or none, through the presence channel', () => {
    const { connection, client } = connect();
    const setLocal = vi.fn();
    Object.assign(client.presence ?? {}, { setLocal });
    connection.showSelection(['a', 'b']);
    connection.showSelection(null);
    expect(setLocal.mock.calls).toEqual([[{ selection: ['a', 'b'] }], [{ selection: null }]]);
    connection.destroy();
  });
});

describe('SyncedBoardConnection.stopSyncing', () => {
  it('stops the client for good and keeps the store until the connection is destroyed', () => {
    const { connection, client } = connect();
    connection.stopSyncing();
    expect(client.isDestroyed).toBe(true);
    // The store stays readable.
    expect(connection.store.read().objects.size).toBe(0);
    connection.destroy();
  });
});

describe('SyncedBoardConnection.remotePresence', () => {
  it('reads the client`s remote presence, with the relay`s writer stamps, and nobody without it', () => {
    const { connection, client } = connect();
    const mira = {
      principal: { id: 'user-mira', kind: 'user' as const, name: 'Mira', color: '#cc5533' },
      updatedAt: 1,
      writerClientIds: [77],
    };
    client.showRemote([mira]);
    expect([...connection.remotePresence().values()]).toEqual([mira]);
    connection.destroy();
    const store = new YjsDocumentStore();
    const alone = new SyncedBoardConnection(
      store,
      new FakeSyncClient({ store, boardId: 'board-1', url: 'ws://relay.test' }, false),
      userOriginFromClaims(client.claims),
    );
    expect(alone.remotePresence().size).toBe(0);
    alone.destroy();
  });
});

describe('SyncedBoardConnection dot-vote notices', () => {
  it('forwards the client’s votes-changed notices, and listens to nothing without them', () => {
    const { connection, client } = connect();
    const listener = vi.fn();
    // Without the client's notices, listening is a no-op that stops cleanly.
    connection.onVotesChanged(listener)();
    expect(listener).not.toHaveBeenCalled();
    const stop = vi.fn();
    const onVotesChanged = vi.fn(() => stop);
    Object.assign(client, { onVotesChanged });
    expect(connection.onVotesChanged(listener)).toBe(stop);
    expect(onVotesChanged).toHaveBeenCalledWith(listener);
    connection.destroy();
  });
});
