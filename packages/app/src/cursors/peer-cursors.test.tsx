// @vitest-environment jsdom
// Live cursors in the shell, in jsdom (item 10): the peers' cursors on the page shown
// from presence, and the person's mouse or pen shared as a board point, resent as the camera
// moves and cleared when it leaves. In Chrome with two browsers on a relay:
// tooling/scenario/specs/app/live-cursors.spec.ts.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { PresenceCursor, PresenceSnapshot, PresenceState } from '@canvas/collab';
import type { Camera } from '@canvas/engine';
import { DEFAULT_PAGE_ID } from '@canvas/schema';

import type { BoardConnection } from '../collab/board-connection.js';
import { createCameraSource } from '../editing/camera-source.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import type { CursorFrames } from './peer-cursor-layer.js';
import { PeerCursors } from './peer-cursors.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/** Frames that never run: the tests check where cursors land, under reduced motion or not. */
const NO_FRAMES: CursorFrames = { request: () => 1, cancel: () => undefined };

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

/**
 * A connection whose remote presence the test sets, recording the cursors it shares.
 *
 * @returns The connection, what sets the presence, and what it shared.
 */
function fakeConnection() {
  let snapshot: PresenceSnapshot = new Map();
  const listeners = new Set<() => void>();
  const shared: (PresenceCursor | null)[] = [];
  const connection = {
    status: () => ({}),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    remotePresence: () => snapshot,
    showCursor: (cursor: PresenceCursor | null) => shared.push(cursor),
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
 * An engine with a camera and pages the test moves.
 *
 * @returns The engine, and what sets its camera and page.
 */
function fakeEngine() {
  let camera = CAMERA;
  let page: string = DEFAULT_PAGE_ID;
  const listeners = new Set<() => void>();
  const engine = {
    camera: () => camera,
    pages: {
      current: () => page,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  } as unknown as MountedEngine;
  return {
    engine,
    setCamera: (next: Camera) => {
      camera = next;
    },
    showPage: (next: string) => {
      page = next;
      act(() => {
        for (const listener of listeners) listener();
      });
    },
  };
}

/**
 * Renders the cursors beside a canvas, as the shell does.
 *
 * @returns The fakes, the board's area and the camera source.
 */
function renderCursors() {
  const connection = fakeConnection();
  const engine = fakeEngine();
  const camera = createCameraSource();
  camera.write(CAMERA);
  const { container } = render(
    <div data-testid="area">
      <canvas />
      <PeerCursors
        connection={connection.connection}
        engine={engine.engine}
        camera={camera}
        frames={NO_FRAMES}
      />
    </div>,
  );
  const area = container.firstElementChild as HTMLElement;
  return { ...connection, ...engine, camera, area };
}

/**
 * A pointer event on the board's area.
 *
 * @param area - The area.
 * @param type - The event.
 * @param init - Where, and which pointer.
 * @param init.clientX - Its viewport x, CSS px.
 * @param init.clientY - Its viewport y, CSS px.
 * @param init.pointerType - The pointer: mouse, pen or touch.
 */
function pointer(
  area: HTMLElement,
  type: 'pointermove' | 'pointerleave',
  init: { clientX?: number; clientY?: number; pointerType: string },
): void {
  const event = new MouseEvent(type, { clientX: init.clientX ?? 0, clientY: init.clientY ?? 0 });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType });
  act(() => {
    area.dispatchEvent(event);
  });
}

describe('PeerCursors', () => {
  it('draws the peers with a cursor on the page shown', () => {
    const { area, setPresence, showPage } = renderCursors();
    setPresence(
      new Map([
        [1, peer('mira', { cursor: { x: 30, y: 40 } })],
        [2, peer('jonas', { cursor: { x: 1, y: 1 }, page: 'p2' })],
        [3, peer('bea', {})],
      ]),
    );
    const drawn = (): (string | undefined)[] =>
      [...area.querySelectorAll<HTMLElement>('[data-peer-cursor]')].map(
        (element) => element.dataset.principalId,
      );
    expect(drawn()).toEqual(['mira']);
    expect(area.querySelector<HTMLElement>('[data-peer-cursor]')?.style.transform).toBe(
      'translate(30px, 40px)',
    );
    showPage('p2');
    expect(drawn()).toEqual(['jonas']);
  });

  it('shares a mouse or pen as a board point, again on a camera move, and clears it on leave', () => {
    const { area, shared, camera, setCamera } = renderCursors();
    pointer(area, 'pointermove', { clientX: 100, clientY: 50, pointerType: 'mouse' });
    pointer(area, 'pointermove', { clientX: 120, clientY: 60, pointerType: 'touch' });
    expect(shared).toEqual([{ x: 100, y: 50 }]);
    const moved = { ...CAMERA, x: 10, zoom: 2 };
    setCamera(moved);
    act(() => {
      camera.write(moved);
    });
    expect(shared.at(-1)).toEqual({ x: 60, y: 25 });
    pointer(area, 'pointerleave', { pointerType: 'pen' });
    expect(shared.at(-1)).toBeNull();
    const count = shared.length;
    act(() => {
      camera.write(CAMERA);
    });
    expect(shared).toHaveLength(count);
  });

  it('clears the shared cursor when it unmounts', () => {
    const { area, shared } = renderCursors();
    pointer(area, 'pointermove', { clientX: 5, clientY: 5, pointerType: 'mouse' });
    cleanup();
    expect(shared).toEqual([{ x: 5, y: 5 }, null]);
  });
});
