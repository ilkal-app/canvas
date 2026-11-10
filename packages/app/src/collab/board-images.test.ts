import { describe, expect, it, vi } from 'vitest';

import { CacheWriteTracker } from '@canvas/collab';

import { PageImages } from '../assets/page-images.js';

import type { BoardAddress } from './board-address.js';
import type { BoardConnection, BoardRecoverySource } from './board-connection.js';
import { boardImageAccessOf, pageImagesFor, withBoardImages } from './board-images.js';

const ADDRESS: BoardAddress = {
  boardId: 'board-a',
  relayUrl: 'ws://relay.test',
  token: undefined,
  tokenUrl: 'http://relay.test/token',
  assetsUrl: 'http://assets.test',
};

/**
 * A token endpoint that answers `token-<board>`.
 *
 * @returns The fetch, a spy.
 */
function tokenEndpoint() {
  return vi.fn<typeof fetch>((input) => {
    const url = input instanceof Request ? input.url : input;
    const board = new URL(url).searchParams.get('board') ?? '';
    return Promise.resolve(Response.json({ token: `token-${board}` }));
  });
}

describe('boardImageAccessOf', () => {
  it('reads the reader’s token and other boards’ from the token endpoint', async () => {
    const fetch = tokenEndpoint();
    const access = boardImageAccessOf(ADDRESS, { subject: () => 'guest', fetch });
    expect(access).toMatchObject({ assetsUrl: 'http://assets.test', boardId: 'board-a' });
    expect(await access?.token(false)).toBe('token-board-a');
    expect(await access?.tokenFor('board-b')).toBe('token-board-b');
  });

  it('uses the page’s given token, and has no other board’s without an endpoint', async () => {
    const access = boardImageAccessOf(
      { ...ADDRESS, token: 'given', tokenUrl: undefined },
      { subject: () => 'guest' },
    );
    expect(await access?.token(true)).toBe('given');
    expect(await access?.tokenFor('board-b')).toBeUndefined();
  });

  it('is none without an assets service or any token', () => {
    expect(boardImageAccessOf({ ...ADDRESS, assetsUrl: undefined }, { subject: () => 'g' })).toBe(
      undefined,
    );
    expect(
      boardImageAccessOf(
        { ...ADDRESS, token: undefined, tokenUrl: undefined },
        { subject: () => 'g' },
      ),
    ).toBeUndefined();
  });
});

describe('withBoardImages and pageImagesFor', () => {
  it('carries the images with the connection and destroys them with it', () => {
    const destroyed: string[] = [];
    const listener = () => undefined;
    const subscribe = vi.fn(() => () => undefined);
    const stopNotice = vi.fn();
    const onThreadsChanged = vi.fn(() => stopNotice);
    const stopVotes = vi.fn();
    const onVotesChanged = vi.fn(() => stopVotes);
    const reactions = { send: vi.fn(), subscribe: vi.fn() };
    let recovery: BoardRecoverySource | undefined = undefined;
    const cacheWrites = new CacheWriteTracker();
    const connection = {
      get recovery() {
        return recovery;
      },
      cacheWrites,
      store: {},
      origin: { kind: 'user', principalId: 'user:a' },
      status: () => ({ kind: 'local' }),
      subscribe,
      onThreadsChanged,
      onVotesChanged,
      reactions,
      dismissStrandedEdits: (source: string) => destroyed.push(`dismissed ${source}`),
      showPage: (pageId: string) => destroyed.push(`shown ${pageId}`),
      destroy: () => destroyed.push('connection'),
    } as unknown as BoardConnection;
    const images = pageImagesFor({ ...ADDRESS, assetsUrl: undefined }, { subject: () => 'g' });
    images.destroy = () => destroyed.push('images');
    const withImages = withBoardImages(connection, images);
    expect(withImages.recovery).toBeUndefined();
    recovery = {
      state: { phase: 'retained', unresolvedRecordCount: 2 },
      subscribe: () => () => undefined,
      exportSources: () => Promise.resolve([]),
    };
    expect(withImages.recovery).toBe(recovery);
    expect(withImages.images).toBe(images);
    // The board's reactions go with it.
    expect(withImages.reactions).toBe(reactions);
    expect(withImages.cacheWrites).toBe(cacheWrites);
    expect(images.boardId).toBe('board-a');
    expect(withImages.status()).toEqual({ kind: 'local' });
    withImages.subscribe(listener);
    expect(subscribe).toHaveBeenCalledWith(listener);
    expect(withImages.onThreadsChanged?.(listener)).toBe(stopNotice);
    expect(onThreadsChanged).toHaveBeenCalledWith(listener);
    // The dot vote's notices too.
    expect(withImages.onVotesChanged?.(listener)).toBe(stopVotes);
    expect(onVotesChanged).toHaveBeenCalledWith(listener);
    withImages.dismissStrandedEdits('old');
    withImages.showPage?.('page-2');
    withImages.destroy();
    expect(destroyed).toEqual(['dismissed old', 'shown page-2', 'images', 'connection']);
    expect(images).toBeInstanceOf(PageImages);
    // A connection that cannot reconnect on request offers no Retry now through the images.
    expect('retryNow' in withImages).toBe(false);
    // Nor a way to stop syncing it does not have.
    expect('stopSyncing' in withImages).toBe(false);
    // Nor presence it does not have.
    expect('remotePresence' in withImages).toBe(false);
    expect('localPresence' in withImages).toBe(false);
  });

  it('forwards the local presence, the spotlight and whom one follows', () => {
    const local = { clientId: 1, state: {} };
    const showSpotlight = vi.fn();
    const showFollowing = vi.fn();
    const connection = {
      store: {},
      origin: { kind: 'user', principalId: 'user:a' },
      status: () => ({ kind: 'synced' }),
      subscribe: () => () => undefined,
      dismissStrandedEdits: () => undefined,
      localPresence: () => local,
      showSpotlight,
      showFollowing,
      destroy: () => undefined,
    } as unknown as BoardConnection;
    const images = pageImagesFor({ ...ADDRESS, assetsUrl: undefined }, { subject: () => 'g' });
    const withImages = withBoardImages(connection, images);
    expect(withImages.localPresence?.()).toBe(local);
    withImages.showSpotlight?.({ startedAt: 5 });
    withImages.showFollowing?.('ana');
    expect(showSpotlight).toHaveBeenCalledWith({ startedAt: 5 });
    expect(showFollowing).toHaveBeenCalledWith('ana');
    images.destroy();
  });

  it('forwards the remote presence of a connection that has it', () => {
    const presence = new Map();
    const connection = {
      store: {},
      origin: { kind: 'user', principalId: 'user:a' },
      status: () => ({ kind: 'synced' }),
      subscribe: () => () => undefined,
      dismissStrandedEdits: () => undefined,
      remotePresence: () => presence,
      destroy: () => undefined,
    } as unknown as BoardConnection;
    const images = pageImagesFor({ ...ADDRESS, assetsUrl: undefined }, { subject: () => 'g' });
    expect(withBoardImages(connection, images).remotePresence?.()).toBe(presence);
    images.destroy();
  });

  it('forwards stopping the sync to a connection that syncs', () => {
    const stopSyncing = vi.fn();
    const connection = {
      store: {},
      origin: { kind: 'user', principalId: 'user:a' },
      status: () => ({ kind: 'synced' }),
      subscribe: () => () => undefined,
      dismissStrandedEdits: () => undefined,
      stopSyncing,
      destroy: () => undefined,
    } as unknown as BoardConnection;
    const images = pageImagesFor({ ...ADDRESS, assetsUrl: undefined }, { subject: () => 'g' });
    withBoardImages(connection, images).stopSyncing?.();
    expect(stopSyncing).toHaveBeenCalledTimes(1);
    images.destroy();
  });

  it('forwards the text the person edits to presence, and nothing where it has none', () => {
    const showEditing = vi.fn();
    const connection = {
      store: {},
      origin: { kind: 'user', principalId: 'user:a' },
      status: () => ({ kind: 'synced' }),
      subscribe: () => () => undefined,
      dismissStrandedEdits: () => undefined,
      showEditing,
      destroy: () => undefined,
    } as unknown as BoardConnection;
    const images = pageImagesFor({ ...ADDRESS, assetsUrl: undefined }, { subject: () => 'g' });
    const spot = { objectId: 'note-1', anchor: 0, focus: 2 };
    withBoardImages(connection, images).showEditing?.(spot);
    const silent: Partial<BoardConnection> = { ...connection };
    delete silent.showEditing;
    withBoardImages(silent as BoardConnection, images).showEditing?.(null);
    expect(showEditing.mock.calls).toEqual([[spot]]);
    images.destroy();
  });

  it('forwards the view shown to presence, and nothing where it has none', () => {
    const showViewport = vi.fn();
    const connection = {
      store: {},
      origin: { kind: 'user', principalId: 'user:a' },
      status: () => ({ kind: 'synced' }),
      subscribe: () => () => undefined,
      dismissStrandedEdits: () => undefined,
      showViewport,
      destroy: () => undefined,
    } as unknown as BoardConnection;
    const images = pageImagesFor({ ...ADDRESS, assetsUrl: undefined }, { subject: () => 'g' });
    const viewport = { x: 0, y: 0, w: 10, h: 10, zoom: 1 };
    withBoardImages(connection, images).showViewport?.(viewport);
    const silent: Partial<BoardConnection> = { ...connection };
    delete silent.showViewport;
    withBoardImages(silent as BoardConnection, images).showViewport?.(null);
    expect(showViewport.mock.calls).toEqual([[viewport]]);
    images.destroy();
  });

  it('forwards the pointer to presence, and nothing where it has none', () => {
    const showCursor = vi.fn();
    const connection = {
      store: {},
      origin: { kind: 'user', principalId: 'user:a' },
      status: () => ({ kind: 'synced' }),
      subscribe: () => () => undefined,
      dismissStrandedEdits: () => undefined,
      showCursor,
      destroy: () => undefined,
    } as unknown as BoardConnection;
    const images = pageImagesFor({ ...ADDRESS, assetsUrl: undefined }, { subject: () => 'g' });
    withBoardImages(connection, images).showCursor?.({ x: 3, y: 4 });
    const silent: Partial<BoardConnection> = { ...connection };
    delete silent.showCursor;
    withBoardImages(silent as BoardConnection, images).showCursor?.(null);
    expect(showCursor.mock.calls).toEqual([[{ x: 3, y: 4 }]]);
    images.destroy();
  });

  it('forwards the selection to presence, and nothing where it has none', () => {
    const showSelection = vi.fn();
    const connection = {
      store: {},
      origin: { kind: 'user', principalId: 'user:a' },
      status: () => ({ kind: 'synced' }),
      subscribe: () => () => undefined,
      dismissStrandedEdits: () => undefined,
      showSelection,
      destroy: () => undefined,
    } as unknown as BoardConnection;
    const images = pageImagesFor({ ...ADDRESS, assetsUrl: undefined }, { subject: () => 'g' });
    withBoardImages(connection, images).showSelection?.(['a']);
    const silent: Partial<BoardConnection> = { ...connection };
    delete silent.showSelection;
    withBoardImages(silent as BoardConnection, images).showSelection?.(null);
    expect(showSelection.mock.calls).toEqual([[['a']]]);
    images.destroy();
  });

  it('forwards Retry now to a connection that can reconnect', () => {
    const retryNow = vi.fn();
    const connection = {
      store: {},
      origin: { kind: 'user', principalId: 'user:a' },
      status: () => ({ kind: 'synced' }),
      subscribe: () => () => undefined,
      dismissStrandedEdits: () => undefined,
      retryNow,
      destroy: () => undefined,
    } as unknown as BoardConnection;
    const images = pageImagesFor({ ...ADDRESS, assetsUrl: undefined }, { subject: () => 'g' });
    withBoardImages(connection, images).retryNow?.();
    expect(retryNow).toHaveBeenCalledTimes(1);
    images.destroy();
  });
});
