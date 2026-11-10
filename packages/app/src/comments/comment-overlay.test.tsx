// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { createObjectCommand, runCommand } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { FAKE_PERSON } from './__fixtures__/fake-member-directory.js';
import { commentContext } from './comment-context.js';
import { commentDataContext, type CommentData } from './comment-data-context.js';
import { CommentOverlay } from './comment-overlay.js';
import { placeThreadPin } from './comment-placement.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function data() {
  return {
    connection: new FakeBoardConnection('board'),
    user: FAKE_PERSON,
    members: [],
    threads: [
      {
        id: 'open',
        pinId: 'pin',
        isResolved: false,
        messages: [
          {
            id: 'm',
            authorId: 'other',
            authorName: 'Other',
            text: 'Hello',
            mentions: [FAKE_PERSON.id],
            createdAt: new Date(0).toISOString(),
          },
        ],
      },
      { id: 'closed', pinId: 'absent-pin', isResolved: true, messages: [] },
    ],
    selectedId: undefined,
    placement: undefined,
    error: 'Retry',
    isBusy: false,
    canEditBoard: false,
    deleteThread: vi.fn(),
    change: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    select: vi.fn(),
    place: vi.fn(),
  } satisfies CommentData;
}

it('renders authorized lists, mentions and retries even before the engine mounts', () => {
  const state = data();
  const mode = {
    canWrite: false,
    isPlacing: false,
    isPanelOpen: true,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
  };
  const view = render(<CommentOverlay engine={undefined} />);
  expect(view.container.textContent).toBe('');
  view.rerender(
    <commentContext.Provider value={mode}>
      <commentDataContext.Provider value={state}>
        <CommentOverlay engine={undefined} />
      </commentDataContext.Provider>
    </commentContext.Provider>,
  );
  expect(screen.getByText('Mentions you')).toBeDefined();
  expect(screen.getByText('Empty thread')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Hello' }));
  expect(state.select).toHaveBeenCalledWith('open');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(state.refresh).toHaveBeenCalledOnce();
  view.rerender(
    <commentContext.Provider value={mode}>
      <commentDataContext.Provider value={{ ...state, selectedId: 'open' }}>
        <CommentOverlay engine={undefined} />
      </commentDataContext.Provider>
    </commentContext.Provider>,
  );
  expect(screen.getByRole('dialog', { name: 'Comment thread' })).toBeDefined();
  state.connection.store.destroy();
});

it('places a pin from a primary canvas click and releases cursor/animation resources', () => {
  const requestFrame = vi.fn(() => 123);
  const cancelFrame = vi.fn();
  vi.stubGlobal('requestAnimationFrame', requestFrame);
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  const state = data();
  expect(
    placeThreadPin(
      state.connection,
      { id: 'pin' as ObjectId, point: { x: 10, y: 20 }, anchor: { kind: 'point' } },
      'open',
    ),
  ).toBe(true);
  const engine = {
    camera: () => ({ x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 }),
  } as MountedEngine;
  const mode = {
    canWrite: true,
    isPlacing: true,
    isPanelOpen: false,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
  };
  const view = render(
    <commentContext.Provider value={mode}>
      <commentDataContext.Provider value={{ ...state, error: '' }}>
        <div>
          <canvas style={{ cursor: 'grab' }} />
          <CommentOverlay engine={engine} />
        </div>
      </commentDataContext.Provider>
    </commentContext.Provider>,
  );
  const pin = screen.getByRole('button', { name: 'Comment thread: Hello' });
  expect(pin.style.left).toBe('10px');
  expect(pin.style.top).toBe('20px');
  fireEvent.click(pin);
  expect(state.select).toHaveBeenCalledWith('open');
  const canvas = view.container.querySelector('canvas');
  if (!canvas) throw new Error('canvas missing');
  expect(canvas.style.cursor).toBe('crosshair');
  fireEvent(
    canvas,
    new MouseEvent('pointerdown', { button: 2, clientX: 200, clientY: 150, bubbles: true }),
  );
  expect(state.place).not.toHaveBeenCalled();
  fireEvent(
    canvas,
    new MouseEvent('pointerdown', { button: 0, clientX: 200, clientY: 150, bubbles: true }),
  );
  expect(state.place).toHaveBeenCalledWith(
    expect.objectContaining({ point: { x: 200, y: 150 }, anchor: { kind: 'point' } }),
  );
  view.unmount();
  expect(canvas.style.cursor).toBe('grab');
  expect(cancelFrame).toHaveBeenCalledWith(123);
  state.connection.store.destroy();
});

it('marks the open pin, and closes the card on a press outside it and the pins', () => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const state = { ...data(), error: '', selectedId: 'open' };
  placeThreadPin(
    state.connection,
    { id: 'pin' as ObjectId, point: { x: 10, y: 20 }, anchor: { kind: 'point' } },
    'open',
  );
  const engine = {
    camera: () => ({ x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 }),
  } as MountedEngine;
  const mode = {
    canWrite: true,
    isPlacing: false,
    isPanelOpen: false,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
  };
  render(
    <commentContext.Provider value={mode}>
      <commentDataContext.Provider value={state}>
        <div>
          <canvas />
          <CommentOverlay engine={engine} />
        </div>
      </commentDataContext.Provider>
    </commentContext.Provider>,
  );
  const pin = screen.getByRole('button', { name: 'Comment thread: Hello' });
  expect(pin.dataset.state).toBe('open');
  expect(pin.getAttribute('aria-expanded')).toBe('true');
  const card = screen.getByRole('dialog', { name: 'Comment thread' });
  // Beside the pin: the pin's box is 28 px, anchored at its bottom-left corner on (10, 20).
  expect(card.style.left).toBe(`${String(10 + 28 + 8)}px`);
  fireEvent.pointerDown(pin);
  fireEvent.pointerDown(card);
  expect(state.close).not.toHaveBeenCalled();
  fireEvent.pointerDown(document.body);
  expect(state.close).toHaveBeenCalledOnce();
  state.connection.store.destroy();
});

it('hides a pin while the person’s gesture moves its object, and shows it 120 ms after the drop', () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const state = { ...data(), error: '' };
  const { store } = state.connection;
  const environment = { clock: () => 1, createId: () => 'note' as ObjectId };
  runCommand(
    store,
    state.connection.origin,
    createObjectCommand,
    {
      object: {
        type: 'sticky',
        x: 100,
        y: 100,
        rotation: 0,
        width: 160,
        height: 160,
        text: '',
        runs: [
          {
            length: 0,
            style: {
              fontFamily: 'Inter',
              fontSize: 16,
              color: [0, 0, 0, 1],
              weight: 400,
              italic: false,
            },
          },
        ],
        align: 'center',
        autoWidth: false,
        verticalAlign: 'middle',
        color: [1, 0.92, 0.55, 1],
      },
    },
    environment,
  );
  const isPlaced = placeThreadPin(
    state.connection,
    {
      id: 'pin' as ObjectId,
      point: { x: 100, y: 100 },
      anchor: { kind: 'object', objectId: 'note' as ObjectId, offset: { x: 0, y: 0 } },
    },
    'open',
  );
  expect(isPlaced).toBe(true);
  const moving = new Set<string>();
  const engine = {
    camera: () => ({ x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 }),
    board: { isMoving: (id: string) => moving.has(id) },
  } as unknown as MountedEngine;
  const mode = {
    canWrite: true,
    isPlacing: false,
    isPanelOpen: false,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
  };
  render(
    <commentContext.Provider value={mode}>
      <commentDataContext.Provider value={state}>
        <div>
          <canvas />
          <CommentOverlay engine={engine} />
        </div>
      </commentDataContext.Provider>
    </commentContext.Provider>,
  );
  const frame = (at: number): void => {
    now = at;
    act(() => {
      frames.shift()?.(at);
    });
  };
  // A faded-out pin is not in the accessibility tree.
  const pin = (): HTMLElement => {
    const found = document.querySelector<HTMLElement>('[data-comment-pin]');
    if (!found) throw new Error('no pin');
    return found;
  };
  expect(pin().dataset.moving).toBe('false');
  // The drag: the select tool previews the note elsewhere; the document has not changed.
  moving.add('note');
  frame(16);
  expect(pin().dataset.moving).toBe('true');
  // The drop: the preview ends and the document has the note at its new place.
  moving.delete('note');
  store.transact(state.connection.origin, (transaction) => {
    const stored = store.get('note' as ObjectId);
    if (!stored) throw new Error('no note');
    transaction.setObject({ ...stored, x: 150 });
  });
  frame(100);
  expect(pin().dataset.moving).toBe('true');
  frame(219);
  expect(pin().dataset.moving).toBe('true');
  frame(220);
  expect(pin().dataset.moving).toBe('false');
  expect(pin().style.left).toBe('150px');
  // A collaborator resizes the note from its far corner: the pin's point stays, the note moves.
  store.transact(state.connection.origin, (transaction) => {
    const stored = store.get('note' as ObjectId);
    if (stored?.type !== 'sticky') throw new Error('no note');
    transaction.setObject({ ...stored, width: 300 });
  });
  frame(400);
  expect(pin().dataset.moving).toBe('true');
  frame(520);
  expect(pin().dataset.moving).toBe('false');
  store.destroy();
});

it('draws overlapping pins as one cluster, whose press frames their threads', () => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const base = data();
  const [first] = base.threads;
  if (!first) throw new Error('no thread');
  const state = {
    ...base,
    error: '',
    threads: [first, { ...first, id: 'second', pinId: 'pin-2' }],
  };
  for (const [id, x, threadId] of [
    ['pin', 100, 'open'],
    ['pin-2', 110, 'second'],
  ] as const) {
    placeThreadPin(
      state.connection,
      { id: id as ObjectId, point: { x, y: 200 }, anchor: { kind: 'point' } },
      threadId,
    );
  }
  const runCanvasAction = vi.fn();
  const engine = {
    camera: () => ({ x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 }),
    board: {},
    runCanvasAction,
  } as unknown as MountedEngine;
  const mode = {
    canWrite: true,
    isPlacing: false,
    isPanelOpen: false,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
  };
  render(
    <commentContext.Provider value={mode}>
      <commentDataContext.Provider value={state}>
        <div>
          <canvas />
          <CommentOverlay engine={engine} />
        </div>
      </commentDataContext.Provider>
    </commentContext.Provider>,
  );
  expect(screen.queryByRole('button', { name: /^Comment thread: / })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '2 comment threads: zoom to them' }));
  expect(runCanvasAction).toHaveBeenCalledWith({
    type: 'frame',
    bounds: { minX: 100, minY: 200, maxX: 110, maxY: 200 },
  });
  state.connection.store.destroy();
});
