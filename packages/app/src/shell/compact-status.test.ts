import { describe, expect, it } from 'vitest';

import type { BoardConnectionStatus } from '../collab/board-connection-status.js';

import { COMPACT_LOADING_LIVE_STATUS, compactStatusOf } from './compact-status.js';

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

const MIRA = { principalId: 'mira', kind: 'user', name: 'Mira', color: '#8e4ec6' } as const;
const JONAS = { principalId: 'jonas', kind: 'user', name: 'Jonas', color: '#12a594' } as const;
const SELF = { principalId: 'vivek', kind: 'user', name: 'Vivek', color: '#ad7f16' } as const;

describe('compactStatusOf', () => {
  it('says Live and how many others are here, as the mobile design’s “Live · 3 here”', () => {
    const status = { ...CONNECTED, collaborators: [MIRA, JONAS] };
    expect(compactStatusOf(status, undefined)).toBe('Live · 2 here');
  });

  it('says Live alone when nobody else is here', () => {
    expect(compactStatusOf(CONNECTED, undefined)).toBe('Live');
  });

  it('leaves the signed-in person out of the count', () => {
    const status = { ...CONNECTED, collaborators: [MIRA, SELF] };
    expect(compactStatusOf(status, 'vivek')).toBe('Live · 1 here');
  });

  it('says the saved copy shows while the live board loads (L1)', () => {
    const status = { ...CONNECTED, state: 'connecting' } as const;
    expect(compactStatusOf(status, undefined)).toBe(COMPACT_LOADING_LIVE_STATUS);
    expect(COMPACT_LOADING_LIVE_STATUS).toBe('Saved copy · Connecting');
  });

  it('says Offline and Reconnecting as the presence bar does (X1)', () => {
    expect(compactStatusOf({ ...CONNECTED, state: 'offline' }, undefined)).toBe('Offline');
    expect(compactStatusOf({ ...CONNECTED, state: 'reconnecting' }, undefined)).toBe(
      'Reconnecting',
    );
  });

  it('keeps read-only in the line for a person who may only look', () => {
    expect(compactStatusOf({ ...CONNECTED, isReadOnly: true }, undefined)).toBe('Live · read-only');
  });
});
