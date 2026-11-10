import { describe, expect, it } from 'vitest';

import type { BoardConnectionStatus } from './board-connection-status.js';
import {
  describeConnection,
  isAwayFromRelay,
  isLoadingLiveBoard,
  SESSION_ENDED_REASON,
  shortConnectionLabel,
} from './connection-label.js';

const CONNECTED: BoardConnectionStatus = {
  boardId: 'demo',
  state: 'connected',
  isLocalOnly: false,
  isSavedOnDevice: true,
  pendingUpdateCount: 0,
  isAcknowledged: true,
  isReadOnly: false,
  rejectionReason: undefined,
  collaborators: [],
  strandedEdits: [],
};

const PEER = { principalId: 'guest-9', kind: 'user', name: 'guest-9', color: '#0090ff' } as const;

describe('describeConnection', () => {
  it('names each connection state', () => {
    const labels = (
      ['connecting', 'connected', 'reconnecting', 'offline', 'unauthorized', 'outdated'] as const
    ).map((state) => describeConnection({ ...CONNECTED, state }).label);
    expect(labels).toEqual([
      'Connecting…',
      'Connected',
      'Reconnecting…',
      'Offline',
      'Not authorized',
      'App out of date: reload the page',
    ]);
  });

  it('says a change is too large to sync when the relay refused one too large to split', () => {
    const tooLarge = describeConnection({
      ...CONNECTED,
      state: 'outdated',
      rejectionReason: 'update-too-large',
      pendingUpdateCount: 1,
    });
    expect(tooLarge.label).toBe('A change is too large to sync');
    expect(tooLarge.detail).toContain('larger than the server accepts in one piece');
    expect(tooLarge.detail).not.toContain('Reload the page');
  });

  it('says a local-only board is offline and local, or not saved when it lives in memory', () => {
    const local = { ...CONNECTED, state: 'offline', isLocalOnly: true } as const;
    expect(describeConnection(local).label).toBe('Offline · local board');
    expect(describeConnection({ ...local, isSavedOnDevice: false }).label).toBe(
      'Offline · not saved',
    );
  });

  it('counts the others on the board while connected', () => {
    expect(describeConnection({ ...CONNECTED, collaborators: [PEER] }).label).toBe(
      'Connected · 1 other',
    );
    expect(describeConnection({ ...CONNECTED, collaborators: [PEER, PEER] }).label).toBe(
      'Connected · 2 others',
    );
  });

  it('details the collaborators, unsent edits and a refusal, never the board’s id', () => {
    expect(
      describeConnection({
        ...CONNECTED,
        state: 'unauthorized',
        rejectionReason: 'expired',
        pendingUpdateCount: 3,
        collaborators: [PEER],
      }).detail,
    ).toBe('with guest-9 · 3 edits not yet sent · refused: expired');
    expect(describeConnection(CONNECTED).detail).toBe('');
  });

  it('tells an outdated app to reload, that editing is off, and why the relay refused', () => {
    expect(
      describeConnection({
        ...CONNECTED,
        state: 'outdated',
        rejectionReason: 'unreadable-layout',
        pendingUpdateCount: 2,
      }).detail,
    ).toBe(
      'This version of the app cannot read this board. Reload the page to get the ' +
        'new version; until then editing is off and nothing is sent · 2 edits not yet sent · ' +
        'refused: unreadable-layout',
    );
  });

  it.each(['unversioned', 'update-depth-exceeded', 'update-malformed'])(
    'says unsupported data cannot be opened (%s)',
    (reason) => {
      const untrusted = describeConnection({
        ...CONNECTED,
        state: 'outdated',
        rejectionReason: reason,
      });
      expect(untrusted.label).toBe('This board cannot be opened safely right now');
      expect(untrusted.detail).toBe(
        'The board holds changes this app cannot trust, and reloading will not help; ' +
          `until they are fixed, editing is off and nothing is sent · refused: ${reason}`,
      );
      const newerStamp = describeConnection({
        ...CONNECTED,
        state: 'outdated',
        rejectionReason: 'unreadable-version',
      });
      expect(newerStamp.label).toBe('App out of date: reload the page');
    },
  );

  it('names at most five collaborators in the detail and counts the rest', () => {
    const peers = [...Array(300).keys()].map((index) => ({
      ...PEER,
      principalId: `guest-${String(index)}`,
      name: `guest-${String(index)}`,
    }));
    const { detail } = describeConnection({ ...CONNECTED, collaborators: peers });
    expect(detail).toBe('with guest-0, guest-1, guest-2, guest-3, guest-4 and 295 more');
    expect(describeConnection({ ...CONNECTED, collaborators: peers.slice(0, 5) }).detail).toBe(
      'with guest-0, guest-1, guest-2, guest-3, guest-4',
    );
  });

  it('keeps the detail short whatever the names and the reason are', () => {
    const peers = [...Array(5).keys()].map((index) => ({
      ...PEER,
      principalId: `p${String(index)}`,
      name: 'n'.repeat(256),
    }));
    const status = { ...CONNECTED, collaborators: peers, rejectionReason: 'r'.repeat(100_000) };
    expect(describeConnection(status).detail.length).toBeLessThan(2000);
  });

  it('does not cut a surrogate pair in half when it cuts a long reason', () => {
    const status = { ...CONNECTED, rejectionReason: `${'r'.repeat(199)}😀${'r'.repeat(50)}` };
    const { detail } = describeConnection(status);
    expect(detail).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(detail.endsWith('r'.repeat(199) + '…')).toBe(true);
  });
});

describe('describeConnection: a session that ended', () => {
  it('says Session ended and what to do, never a reconnection, a sync or the raw reason', () => {
    const ended = {
      ...CONNECTED,
      state: 'unauthorized',
      rejectionReason: SESSION_ENDED_REASON,
      isReadOnly: true,
      pendingUpdateCount: 1,
    } as const;
    const { label, detail } = describeConnection(ended);
    expect(label).toBe('Session ended');
    expect(detail).toContain('Sign in again to keep editing');
    expect(detail).not.toContain('refused');
    expect(shortConnectionLabel(ended)).toBe('Session ended · read-only');
    expect(isAwayFromRelay(ended)).toBe(false);
    // Another refusal keeps its words.
    expect(describeConnection({ ...CONNECTED, state: 'unauthorized' }).label).toBe(
      'Not authorized',
    );
  });
});

describe('shortConnectionLabel', () => {
  it('says Live while connected, whoever else is here', () => {
    expect(shortConnectionLabel(CONNECTED)).toBe('Live');
    expect(shortConnectionLabel({ ...CONNECTED, collaborators: [PEER, PEER] })).toBe('Live');
  });

  it('says what the chip said in every other state', () => {
    // Item 6: Reconnecting, without the chip's ellipsis; the accessible name keeps it.
    expect(shortConnectionLabel({ ...CONNECTED, state: 'reconnecting' })).toBe('Reconnecting');
    expect(describeConnection({ ...CONNECTED, state: 'reconnecting' }).label).toBe('Reconnecting…');
    expect(shortConnectionLabel({ ...CONNECTED, state: 'offline', isLocalOnly: true })).toBe(
      'Offline · local board',
    );
    expect(shortConnectionLabel({ ...CONNECTED, state: 'outdated' })).toBe(
      'App out of date: reload the page',
    );
  });

  it('says Connecting, without the chip’s ellipsis, while the live board loads (L1)', () => {
    expect(shortConnectionLabel({ ...CONNECTED, state: 'connecting' })).toBe('Connecting');
    // The accessible name keeps the full label.
    expect(describeConnection({ ...CONNECTED, state: 'connecting' }).label).toBe('Connecting…');
    expect(shortConnectionLabel({ ...CONNECTED, state: 'connecting', isReadOnly: true })).toBe(
      'Connecting · read-only',
    );
  });

  it('adds read-only for a person who may only look', () => {
    expect(shortConnectionLabel({ ...CONNECTED, isReadOnly: true })).toBe('Live · read-only');
    expect(shortConnectionLabel({ ...CONNECTED, state: 'offline', isReadOnly: true })).toBe(
      'Offline · read-only',
    );
  });
});

describe('isLoadingLiveBoard and isAwayFromRelay', () => {
  const states = [
    'connecting',
    'connected',
    'reconnecting',
    'offline',
    'unauthorized',
    'outdated',
  ] as const;

  it('loads the live board only while a synced board connects', () => {
    expect(states.filter((state) => isLoadingLiveBoard({ ...CONNECTED, state }))).toEqual([
      'connecting',
    ]);
    expect(isLoadingLiveBoard({ ...CONNECTED, state: 'connecting', isLocalOnly: true })).toBe(
      false,
    );
  });

  it('is away from the relay while a synced board is offline or reconnecting, never refused', () => {
    expect(states.filter((state) => isAwayFromRelay({ ...CONNECTED, state }))).toEqual([
      'reconnecting',
      'offline',
    ]);
    // A local-only board never syncs: no banner says it will.
    expect(isAwayFromRelay({ ...CONNECTED, state: 'offline', isLocalOnly: true })).toBe(false);
  });
});

describe('describeConnection with pages', () => {
  it('says the page each named collaborator shows, when its name is known', () => {
    const { detail } = describeConnection(
      {
        ...CONNECTED,
        collaborators: [
          { ...PEER, page: 'p2' },
          { principalId: 'ada', kind: 'user', name: 'Ada', color: '#123456', page: 'gone' },
        ],
      },
      (pageId) => (pageId === 'p2' ? 'Second' : undefined),
    );
    expect(detail).toContain('with guest-9 (on Second), Ada');
  });
});
