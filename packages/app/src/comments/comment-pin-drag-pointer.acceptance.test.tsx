// CONTRACT: the pins keep pointer drags, cancellation, unmount, and later clicks distinct while exposing draggable pins.
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createObjectCommand, runCommand } from '@canvas/document';
import { DEFAULT_PAGE_ID, type ObjectId } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { FAKE_PERSON } from './__fixtures__/fake-member-directory.js';
import { commentRequest, type Thread, type ThreadPin } from './comment-api.js';
import { commentContext } from './comment-context.js';
import { commentDataContext, type CommentData } from './comment-data-context.js';
import { CommentOverlay } from './comment-overlay.js';

vi.mock('./comment-api.js', () => ({ commentRequest: vi.fn() }));
beforeEach(() => {
  vi.mocked(commentRequest).mockReset().mockResolvedValue({ threads: [] });
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pin: ThreadPin = {
  pageId: DEFAULT_PAGE_ID,
  anchor: { kind: 'point' },
  point: { x: 50, y: 60 },
};
const thread: Thread = {
  id: 'thread',
  pinId: 'legacy-pin',
  starterId: FAKE_PERSON.id,
  isResolved: false,
  pin,
  messages: [
    {
      id: 'message',
      authorId: FAKE_PERSON.id,
      authorName: 'Owner',
      text: 'Move me',
      mentions: [],
      createdAt: new Date(0).toISOString(),
    },
  ],
};

function fixture(changes: Partial<Thread> = {}, canEditBoard = false) {
  const connection = new FakeBoardConnection('board');
  const current = { ...thread, ...changes };
  if (current.pin == null) {
    runCommand(
      connection.store,
      connection.origin,
      createObjectCommand,
      {
        object: {
          type: 'comment',
          id: current.pinId,
          x: 50,
          y: 60,
          threadId: current.id,
          anchor: { kind: 'point' },
        },
      },
      { clock: () => 1, createId: () => 'unused' as ObjectId },
    );
  }
  const data = {
    connection,
    user: FAKE_PERSON,
    members: [],
    threads: [current],
    selectedId: undefined,
    placement: undefined,
    error: '',
    isBusy: false,
    canEditBoard,
    movePin: vi.fn().mockResolvedValue(undefined),
    select: vi.fn(),
    close: vi.fn(),
    place: vi.fn(),
    deleteThread: vi.fn(),
    change: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
  } satisfies CommentData;
  const camera = { x: 10, y: 20, zoom: 2, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
  const engine = {
    camera: () => camera,
    pages: { current: () => DEFAULT_PAGE_ID, subscribe: () => () => undefined },
    board: { state: () => ({ selectedIds: [] }), subscribe: () => () => undefined },
  } as unknown as MountedEngine;
  const view = render(
    <commentContext.Provider
      value={{
        canWrite: true,
        isPlacing: false,
        isPanelOpen: false,
        setPlacing: vi.fn(),
        togglePanel: vi.fn(),
      }}
    >
      <commentDataContext.Provider value={data}>
        <canvas />
        <CommentOverlay engine={engine} />
      </commentDataContext.Provider>
    </commentContext.Provider>,
  );
  const button = screen.getByRole('button', { name: 'Comment thread: Move me' });
  return { connection, data, button, unmount: view.unmount };
}

function gesture(
  button: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(document, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.click(button);
}

it('keeps the button name, adds a drag tooltip, and opens on a press moving under 4 CSS px', () => {
  const f = fixture();
  expect(f.button.title).toMatch(/ · Drag to move$/);
  expect(f.button.hasAttribute('data-draggable')).toBe(true);
  gesture(f.button, { x: 80, y: 80 }, { x: 83, y: 80 });
  expect(f.data.select).toHaveBeenCalledWith('thread');
  expect(f.data.movePin).not.toHaveBeenCalled();
  f.connection.store.destroy();
});

it('ignores another pointer’s release until the dragging pointer releases', async () => {
  const f = fixture();
  fireEvent.pointerDown(f.button, { button: 0, pointerId: 1, clientX: 80, clientY: 80 });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerUp(document, { pointerId: 2, clientX: 120, clientY: 120 });
  expect(f.data.movePin).not.toHaveBeenCalled();
  fireEvent.pointerUp(document, { pointerId: 1, clientX: 100, clientY: 100 });
  await waitFor(() => {
    expect(f.data.movePin).toHaveBeenCalledOnce();
  });
  expect(f.data.select).not.toHaveBeenCalled();
  f.connection.store.destroy();
});

it('restores the pin after its pointer is cancelled without saving or selecting', () => {
  const f = fixture();
  fireEvent.pointerDown(f.button, { button: 0, pointerId: 1, clientX: 80, clientY: 80 });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 100, clientY: 100 });
  expect(f.button.style.left).toBe('100px');
  fireEvent.pointerCancel(document, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerUp(document, { pointerId: 1, clientX: 100, clientY: 100 });
  expect(f.button.style.left).toBe('80px');
  expect(f.data.movePin).not.toHaveBeenCalled();
  expect(f.data.select).not.toHaveBeenCalled();
  f.connection.store.destroy();
});

it('does not save when the pin unmounts during a drag', () => {
  const f = fixture();
  fireEvent.pointerDown(f.button, { button: 0, pointerId: 1, clientX: 80, clientY: 80 });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 100, clientY: 100 });
  f.unmount();
  fireEvent.pointerUp(document, { pointerId: 1, clientX: 100, clientY: 100 });
  expect(f.data.movePin).not.toHaveBeenCalled();
  f.connection.store.destroy();
});

it('opens on a fresh short press after a drag released without a click', async () => {
  const f = fixture();
  fireEvent.pointerDown(f.button, { button: 0, pointerId: 1, clientX: 80, clientY: 80 });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerUp(document, { pointerId: 1, clientX: 100, clientY: 100 });
  await waitFor(() => {
    expect(f.data.movePin).toHaveBeenCalledOnce();
  });
  fireEvent.pointerDown(f.button, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
  fireEvent.pointerUp(document, { pointerId: 2, clientX: 102, clientY: 100 });
  fireEvent.click(f.button);
  expect(f.data.select).toHaveBeenCalledExactlyOnceWith('thread');
  f.connection.store.destroy();
});
