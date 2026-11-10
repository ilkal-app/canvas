// @vitest-environment jsdom
// The collaborators a minimap draws: the connection's presence and the page shown.
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { useMinimapPeers } from './use-minimap-peers.js';

describe('useMinimapPeers', () => {
  it('reads the connection’s presence, follows its changes, and the engine’s page', () => {
    const connection = new FakeBoardConnection('board');
    const snapshot = new Map();
    Object.assign(connection, { remotePresence: () => snapshot });
    const engine = { pages: { current: () => 'page-3' } } as unknown as MountedEngine;
    const { result } = renderHook(() => useMinimapPeers(connection, engine));
    const peers = result.current;
    expect(peers?.remotePresence()).toBe(snapshot);
    expect(peers?.pageOf()).toBe('page-3');
    const listener = vi.fn();
    const stop = peers?.subscribe(listener);
    connection.setState('reconnecting');
    expect(listener).toHaveBeenCalled();
    stop?.();
  });

  it('is the first page without the engine’s pages, and nothing without presence', () => {
    const connection = new FakeBoardConnection('board');
    expect(renderHook(() => useMinimapPeers(connection, undefined)).result.current).toBeUndefined();
    Object.assign(connection, { remotePresence: () => new Map() });
    const { result } = renderHook(() => useMinimapPeers(connection, undefined));
    expect(result.current?.pageOf()).toBe('page-1');
    expect(renderHook(() => useMinimapPeers(undefined, undefined)).result.current).toBeUndefined();
  });
});
