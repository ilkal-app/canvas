// @vitest-environment jsdom
// Collaborators' selections in jsdom (item 14): which peers' selections show, the
// person's own selection shared as ids, and the name tags placed by the camera. In Chrome with
// two browsers on a relay: tooling/scenario/specs/app/peer-selections.spec.ts.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { colorForPrincipal, type PresenceSnapshot, type PresenceState } from '@canvas/collab';
import { DEFAULT_PAGE_ID } from '@canvas/schema';

import type { BoardConnection } from '../collab/board-connection.js';
import type { BoardViewChange } from '../engine/board-view.js';
import type { PeerSelectionInput, PeerSelectionPlacement } from '../engine/mount-peer-selection.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { createCameraSource } from './camera-source.js';
import { PeerSelections } from './peer-selections.js';
import { MAX_SHARED_SELECTION, peerSelectionsOf } from './use-peer-selections.js';

const CAMERA = { x: -10, y: -20, zoom: 2, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

afterEach(cleanup);

/**
 * A peer's presence.
 *
 * @param id - The principal id.
 * @param fields - The rest.
 * @returns The state.
 */
function peer(id: string, fields: Partial<PresenceState>): PresenceState {
  return {
    principal: { id, kind: 'user', name: id, color: '#3366cc' },
    updatedAt: 0,
    ...fields,
  };
}

describe('peerSelectionsOf', () => {
  it('lists the peers selecting on the page shown, each tab apart', () => {
    const snapshot: PresenceSnapshot = new Map([
      [1, peer('mira', { selection: ['a', 'b'] })],
      [2, peer('mira', { selection: ['c'] })],
      [3, peer('jo', { selection: ['d'], page: 'p2' })],
      [4, peer('bea', { selection: [] })],
      [5, peer('kai', {})],
    ]);
    expect(peerSelectionsOf(snapshot, DEFAULT_PAGE_ID, DEFAULT_PAGE_ID)).toEqual([
      // Her colourway's dark, from her id; the colour her client sent is ignored.
      {
        clientId: 1,
        principalId: 'mira',
        name: 'mira',
        color: colorForPrincipal('mira'),
        ids: ['a', 'b'],
      },
      {
        clientId: 2,
        principalId: 'mira',
        name: 'mira',
        color: colorForPrincipal('mira'),
        ids: ['c'],
      },
    ]);
    expect(peerSelectionsOf(snapshot, 'p2', DEFAULT_PAGE_ID).map((p) => p.clientId)).toEqual([3]);
  });

  it('leaves a peer editing the one text they select to peer editing', () => {
    const editing = { objectId: 'note', anchor: 0, focus: 0 };
    const snapshot: PresenceSnapshot = new Map([
      [1, peer('mira', { selection: ['note'], editing })],
      [2, peer('jo', { selection: ['note', 'other'], editing })],
    ]);
    expect(
      peerSelectionsOf(snapshot, DEFAULT_PAGE_ID, DEFAULT_PAGE_ID).map((p) => p.clientId),
    ).toEqual([2]);
  });
});

/**
 * A connection whose remote presence the test sets, recording the selections it shares.
 *
 * @returns The connection, what sets the presence, and what it shared.
 */
function fakeConnection() {
  let snapshot: PresenceSnapshot = new Map();
  const listeners = new Set<() => void>();
  const shared: (readonly string[] | null)[] = [];
  const connection = {
    status: () => ({}),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    store: { subscribe: () => () => undefined },
    remotePresence: () => snapshot,
    showSelection: (ids: readonly string[] | null) => shared.push(ids),
  } as unknown as BoardConnection;
  const setPresence = (next: PresenceSnapshot): void => {
    snapshot = next;
    act(() => {
      for (const listener of listeners) listener();
    });
  };
  return { connection, setPresence, shared };
}

/**
 * An engine whose selection the test sets, placing every peer's frame at (5, 10).
 *
 * @returns The engine, what selects, and what its peer selection was asked to show.
 */
function fakeEngine() {
  let state = { documentVersion: 0, selectedIds: [] as readonly string[], enteredGroupId: null };
  const listeners = new Set<(change: BoardViewChange) => void>();
  const shown: (readonly PeerSelectionInput[])[] = [];
  let placed: readonly PeerSelectionPlacement[] = [];
  const placementListeners = new Set<() => void>();
  const engine = {
    board: {
      state: () => state,
      subscribe: (listener: (change: BoardViewChange) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    peerSelection: {
      show: (peers: readonly PeerSelectionInput[]) => {
        shown.push(peers);
        placed = peers.map((each) => ({
          ...each,
          frame: { x: 5, y: 10, width: 40, height: 20, rotation: 0 },
        }));
        for (const listener of placementListeners) listener();
        return placed;
      },
      placements: () => placed,
      subscribe: (listener: () => void) => {
        placementListeners.add(listener);
        return () => placementListeners.delete(listener);
      },
    },
  } as unknown as MountedEngine;
  const select = (ids: readonly string[]): void => {
    state = { ...state, selectedIds: ids };
    act(() => {
      for (const listener of listeners) listener({ kind: 'selection' });
    });
  };
  return { engine, select, shown };
}

function renderSelections() {
  const connection = fakeConnection();
  const engine = fakeEngine();
  const camera = createCameraSource();
  camera.write(CAMERA);
  const result = render(
    <PeerSelections connection={connection.connection} engine={engine.engine} camera={camera} />,
  );
  return { ...connection, ...engine, camera, ...result };
}

describe('PeerSelections', () => {
  it('tags each peer’s selection with their name at its corner, as the camera places it', () => {
    const { container, setPresence, shown } = renderSelections();
    expect(container.querySelector('[data-peer-selections]')).toBeNull();
    setPresence(new Map([[4, peer('mira', { selection: ['a', 'b'] })]]));
    const tag = container.querySelector<HTMLElement>('[data-peer-selection="4"]');
    expect(tag?.textContent).toBe('mira');
    expect(tag?.dataset.principalId).toBe('mira');
    expect(tag?.dataset.presenceColor).toBe(colorForPrincipal('mira'));
    expect(tag?.dataset.selectedCount).toBe('2');
    // (5, 10) at 200% from (-10, -20): (30, 60) on screen.
    expect(tag?.style.left).toBe('30px');
    expect(tag?.style.top).toBe('60px');
    expect(shown.at(-1)?.map((each) => each.ids)).toEqual([['a', 'b']]);
    setPresence(new Map([[4, peer('mira', {})]]));
    expect(container.querySelector('[data-peer-selection]')).toBeNull();
    expect(shown.at(-1)).toEqual([]);
  });

  it('shares the person’s selection as ids, at most the presence limit, and none when cleared', () => {
    const { select, shared } = renderSelections();
    expect(shared).toEqual([null]);
    select(['x', 'y']);
    const many = [...Array(MAX_SHARED_SELECTION + 5).keys()].map((index) => `o${String(index)}`);
    select(many);
    select([]);
    expect(shared.slice(1, 2)).toEqual([['x', 'y']]);
    expect(shared[2]).toHaveLength(MAX_SHARED_SELECTION);
    expect(shared.at(-1)).toBeNull();
  });

  it('clears the shared selection when it unmounts', () => {
    const { select, shared, unmount } = renderSelections();
    select(['x']);
    unmount();
    expect(shared.at(-1)).toBeNull();
    expect(shared.filter((ids) => ids === null)).toHaveLength(2);
  });

  it('sends nothing on unmount when nothing was ever selected', () => {
    const connection = fakeConnection();
    const share = vi.spyOn(connection.connection, 'showSelection');
    const engine = fakeEngine();
    const camera = createCameraSource();
    const { unmount } = render(
      <PeerSelections connection={connection.connection} engine={engine.engine} camera={camera} />,
    );
    unmount();
    expect(share).toHaveBeenCalledTimes(1);
  });
});
