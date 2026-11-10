// @vitest-environment jsdom
// Peers editing text in jsdom (Figma "States" E1): the tag, the outline and caret
// markers from presence, the person's own spot shared, and nothing at rest. In Chrome, with the
// engine drawing the marks: tooling/scenario/specs/app/peer-editing*.spec.ts.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { CollaboratorSummary } from '../collab/board-connection-status.js';
import type { BoardConnection } from '../collab/board-connection.js';
import type { PeerEditingPlacement, PeerEditingSurface } from '../engine/mount-peer-editing.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { createCameraSource } from './camera-source.js';
import type { PeerEditingInput } from './peer-editing-geometry.js';
import { boxStyleOf, PeerEditing, tagStackOf } from './peer-editing.js';
import { TextEditingFeed } from './text-editing-feed.js';
import { peersEditingOf } from './use-peer-editing.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 1440, viewportHeightPx: 900, dpr: 1 };

const BOX = { x: 100, y: 200, width: 176, height: 176, rotation: 0 };

const MIRA_IDLE: CollaboratorSummary = {
  principalId: 'mira',
  kind: 'user',
  name: 'Mira',
  color: '#cc66ff',
};

const MIRA: CollaboratorSummary = {
  ...MIRA_IDLE,
  editing: { objectId: 'note-1', anchor: 2, focus: 2 },
};

afterEach(cleanup);

/**
 * A connection whose status the test sets, recording what it shares.
 *
 * @returns The connection, and what sets its collaborators, changes its board and it shared.
 */
function fakeConnection() {
  let collaborators: readonly CollaboratorSummary[] = [];
  const listeners = new Set<() => void>();
  const storeListeners = new Set<() => void>();
  let status = { collaborators };
  const shared: unknown[] = [];
  const connection = {
    status: () => status,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    store: {
      subscribe: (listener: () => void) => {
        storeListeners.add(listener);
        return () => storeListeners.delete(listener);
      },
    },
    showEditing: (editing: unknown) => shared.push(editing),
  } as unknown as BoardConnection;
  const setCollaborators = (next: readonly CollaboratorSummary[]): void => {
    collaborators = next;
    status = { collaborators };
    act(() => {
      for (const listener of listeners) listener();
    });
  };
  const changeBoard = (): void => {
    act(() => {
      for (const listener of storeListeners) listener();
    });
  };
  return { connection, setCollaborators, changeBoard, shared, storeListeners };
}

/**
 * An engine whose peer editing places every peer on {@link BOX}.
 *
 * @returns The engine, the person's spot, what it was asked to show, and what moves the box.
 */
function fakeEngine() {
  const local = new TextEditingFeed();
  const shown: (readonly PeerEditingInput[])[] = [];
  let box = BOX;
  const surface: PeerEditingSurface = {
    local,
    show: (peers) => {
      shown.push(peers);
      return peers.map((peer) => ({
        ...peer,
        box,
        caret: { ...box, x: box.x + 20, width: 0, height: 24 },
        highlights: [],
      }));
    },
  };
  const engine = { peerEditing: surface } as unknown as MountedEngine;
  const moveTo = (x: number): void => {
    box = { ...box, x };
  };
  return { engine, local, shown, moveTo };
}

describe('peersEditingOf', () => {
  it('lists the collaborators who edit, with their object and offsets', () => {
    const bea: CollaboratorSummary = {
      principalId: 'bea',
      kind: 'user',
      name: 'Bea',
      color: '#000000',
    };
    expect(peersEditingOf([bea, MIRA])).toEqual([
      {
        principalId: 'mira',
        name: 'Mira',
        color: '#cc66ff',
        objectId: 'note-1',
        anchor: 2,
        focus: 2,
      },
    ]);
  });
});

describe('boxStyleOf and tagStackOf', () => {
  it('places a box on screen through the camera, turned, or with a screen width', () => {
    const camera = { ...CAMERA, x: 50, zoom: 2 };
    expect(boxStyleOf({ ...BOX, rotation: 0.5 }, camera)).toEqual({
      left: 100,
      top: 400,
      width: 352,
      height: 352,
      transform: 'rotate(0.5rad)',
    });
    expect(boxStyleOf(BOX, camera, 2).width).toBe(2);
  });

  it('stacks a second tag on one text above the first, and starts afresh per text', () => {
    const at = (objectId: string) => ({ objectId }) as PeerEditingPlacement;
    expect(tagStackOf([at('a'), at('b'), at('a'), at('a')])).toEqual([0, 0, 1, 2]);
  });
});

describe('PeerEditing', () => {
  it('shows nothing and follows no camera while no peer edits', () => {
    const { connection } = fakeConnection();
    const { engine, shown } = fakeEngine();
    const camera = createCameraSource();
    camera.write(CAMERA);
    const subscribe = vi.spyOn(camera, 'subscribe');
    const { container } = render(
      <PeerEditing connection={connection} engine={engine} camera={camera} canEdit />,
    );
    expect(container.innerHTML).toBe('');
    expect(subscribe).not.toHaveBeenCalled();
    expect(shown).toEqual([[]]);
  });

  it('tags a peer’s text with their name in their colour, and marks its outline and caret', () => {
    const { connection, setCollaborators, changeBoard, storeListeners } = fakeConnection();
    const { engine, moveTo } = fakeEngine();
    const camera = createCameraSource();
    camera.write(CAMERA);
    const { container } = render(
      <PeerEditing connection={connection} engine={engine} camera={camera} canEdit />,
    );
    expect(storeListeners.size).toBe(0);
    setCollaborators([MIRA]);
    const tag = screen.getByText('Mira is editing');
    expect(tag.style.left).toBe('100px');
    expect(tag.style.backgroundColor).toBe('rgb(204, 102, 255)');
    expect(tag.getAttribute('data-ink')).toMatch(/^(dark|light)$/);
    const outline = container.querySelector<HTMLElement>('[data-peer-editing-object-id="note-1"]');
    expect(outline?.getAttribute('data-presence-color')).toBe('#cc66ff');
    expect(outline?.getAttribute('data-principal-id')).toBe('mira');
    expect(outline?.style.width).toBe('176px');
    const caret = container.querySelector<HTMLElement>('[data-remote-caret-object-id="note-1"]');
    expect(caret?.getAttribute('data-principal-id')).toBe('mira');
    expect(caret?.style.left).toBe('120px');
    expect(caret?.style.width).toBe('2px');

    // The note moves: the board's change places it again; the camera moves the layer.
    expect(storeListeners.size).toBe(1);
    moveTo(300);
    changeBoard();
    expect(screen.getByText('Mira is editing').style.left).toBe('300px');
    act(() => {
      camera.write({ ...CAMERA, x: 100 });
    });
    expect(screen.getByText('Mira is editing').style.left).toBe('200px');

    // A second peer in the same note stacks above; when both stop, everything goes.
    const bo = { ...MIRA, principalId: 'bo', name: 'Bo' };
    setCollaborators([MIRA, bo]);
    const top = (name: string) =>
      Number.parseFloat(screen.getByText(`${name} is editing`).style.top);
    expect(top('Mira') - top('Bo')).toBe(20);
    setCollaborators([MIRA_IDLE]);
    expect(container.innerHTML).toBe('');
    expect(storeListeners.size).toBe(0);
  });

  it('shows nothing until the camera is known, and clears the engine’s marks on unmount', () => {
    const { connection, setCollaborators } = fakeConnection();
    const { engine, shown } = fakeEngine();
    const camera = createCameraSource();
    const { container, unmount } = render(
      <PeerEditing connection={connection} engine={engine} camera={camera} canEdit />,
    );
    setCollaborators([MIRA]);
    expect(container.innerHTML).toBe('');
    unmount();
    expect(shown.at(-1)).toEqual([]);
  });

  it('shares the person’s spot while the page has the focus, and stops sharing when it goes', () => {
    const { connection, shared } = fakeConnection();
    const { engine, local } = fakeEngine();
    const camera = createCameraSource();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { unmount } = render(
      <PeerEditing connection={connection} engine={engine} camera={camera} canEdit />,
    );
    expect(shared).toEqual([]);
    const spot = { objectId: 'note-1' as ObjectId, anchor: 0, focus: 1 };
    act(() => {
      local.publish(spot);
    });
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    act(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });
    act(() => {
      local.publish(undefined);
      local.publish(spot);
    });
    unmount();
    expect(shared).toEqual([spot, null, spot, null, spot, null]);
  });

  it('shares nothing for a person who may not edit, and clears what it shared once they may not', () => {
    const { connection, shared } = fakeConnection();
    const { engine, local } = fakeEngine();
    const camera = createCameraSource();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const spot = { objectId: 'note-1' as ObjectId, anchor: 0, focus: 1 };
    const viewer = render(
      <PeerEditing connection={connection} engine={engine} camera={camera} canEdit={false} />,
    );
    act(() => {
      local.publish(spot);
    });
    expect(shared).toEqual([]);
    viewer.rerender(
      <PeerEditing connection={connection} engine={engine} camera={camera} canEdit />,
    );
    expect(shared).toEqual([spot]);
    viewer.rerender(
      <PeerEditing connection={connection} engine={engine} camera={camera} canEdit={false} />,
    );
    expect(shared).toEqual([spot, null]);
    viewer.unmount();
  });

  it('shares nothing without a connection that shares, or once the editing ended', () => {
    const { engine, local } = fakeEngine();
    const camera = createCameraSource();
    const { unmount } = render(
      <PeerEditing connection={undefined} engine={engine} camera={camera} canEdit />,
    );
    act(() => {
      local.publish({ objectId: 'note-1' as ObjectId, anchor: 0, focus: 0 });
    });
    unmount();
    const { connection, shared } = fakeConnection();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const quiet = render(
      <PeerEditing connection={connection} engine={engine} camera={camera} canEdit />,
    );
    act(() => {
      local.publish(undefined);
    });
    quiet.unmount();
    expect(shared).toEqual([{ objectId: 'note-1', anchor: 0, focus: 0 }, null]);
  });
});
