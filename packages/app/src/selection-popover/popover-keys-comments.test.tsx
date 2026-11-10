// @vitest-environment jsdom
// The selection popover's keys and Comment: Tab from the canvas into it and Escape back,
// Comment (alone for a commenter), and a thread opening clears the selection.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { commentContext, type CommentMode } from '../comments/comment-context.js';
import { commentDataContext, type CommentData } from '../comments/comment-data-context.js';
import type { CommentPlacement } from '../comments/comment-placement.js';
import { createCameraSource } from '../editing/camera-source.js';
import { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';

import { SelectionPopover, type SelectionPopoverProps } from './selection-popover.js';

/** A 100 × 50 rectangle at (400, 300). */
const RECT = {
  id: 'r' as ObjectId,
  parentId: null,
  rotation: 0,
  locked: false,
  createdBy: 'user:test',
  createdAt: 1,
  updatedAt: 1,
  x: 400,
  y: 300,
  z: 'a0',
  type: 'shape',
  kind: 'rectangle',
  width: 100,
  height: 50,
  stroke: null,
  fill: [1, 0, 0, 1],
  cornerRadius: 0,
  sides: 4,
  label: null,
} as unknown as BoardObject;

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
  return () => {
    vi.restoreAllMocks();
  };
});

afterEach(cleanup);

/** Runs the frames asked for so far. */
function runFrames(): void {
  const due = frames;
  frames = [];
  act(() => {
    for (const frame of due) frame(0);
  });
}

/**
 * The engine with the rectangle on its board, selected.
 *
 * @returns The engine.
 */
function engineWithRect(): FakeMountedEngine {
  const store = new YjsDocumentStore({ clientId: 5 });
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    transaction.setObject(RECT);
  });
  const engine = new FakeMountedEngine(
    document.createElement('canvas'),
    { store },
    Promise.resolve(),
  );
  engine.currentCamera = {
    x: 0,
    y: 0,
    zoom: 1,
    viewportWidthPx: 1000,
    viewportHeightPx: 800,
    dpr: 1,
  };
  engine.select([RECT.id]);
  return engine;
}

/**
 * The popover's props.
 *
 * @param engine - The engine.
 * @param overrides - What differs.
 * @returns The props.
 */
function propsOf(
  engine: FakeMountedEngine,
  overrides: Partial<SelectionPopoverProps> = {},
): SelectionPopoverProps {
  return {
    engine,
    camera: createCameraSource(),
    selection: [RECT],
    canEdit: true,
    isEditingText: false,
    shortcuts: createDefaultShortcutRegistry('mac'),
    dispatch: vi.fn(),
    ...overrides,
  };
}

/**
 * The shell around the popover: its focusable root (which holds the canvas's keys) and the
 * canvas mount.
 *
 * @param props - What it holds.
 * @param props.children - The popover.
 * @returns The shell.
 */
function Shell(props: { readonly children: ReactNode }): ReactElement {
  return (
    <div data-whiteboard-chrome="floating" tabIndex={-1} data-testid="root">
      <main aria-label="Canvas">
        <canvas />
        {props.children}
      </main>
    </div>
  );
}

/**
 * Comments as a signed-in board has them.
 *
 * @param overrides - What differs.
 * @returns The data and the mode.
 */
function comments(overrides: Partial<CommentData> = {}): {
  readonly data: CommentData;
  readonly mode: CommentMode;
} {
  const data = {
    connection: { store: { read: () => ({ objects: new Map([[RECT.id, RECT]]) }) } },
    selectedId: undefined,
    placement: undefined,
    place: vi.fn(),
    ...overrides,
  } as unknown as CommentData;
  const mode = { isPlacing: false, canWrite: true, isPanelOpen: false } as CommentMode;
  return { data, mode };
}

/**
 * The popover row's first control, where Tab lands: More on a row with no style controls, the
 * first of a shape's (Fill) since.
 *
 * @returns The control.
 * @throws {Error} When the popover has no control.
 */
function firstControl(): HTMLElement {
  const first = screen.getByRole('toolbar', { name: 'Selection' }).querySelector('button');
  if (first === null) throw new Error('The popover has no control.');
  return first;
}

describe('SelectionPopover keys', () => {
  it('Tab from the canvas moves focus into the popover; Escape takes it back, keeping it open', () => {
    const engine = engineWithRect();
    const dispatch = vi.fn();
    render(
      <Shell>
        <SelectionPopover {...propsOf(engine, { dispatch })} />
      </Shell>,
    );
    runFrames();
    const root = screen.getByTestId('root');
    root.focus();
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    fireEvent.keyDown(root, { key: 'Tab' });
    const more = firstControl();
    expect(document.activeElement).toBe(more);
    fireEvent.keyDown(more, { key: 'Escape' });
    expect(document.activeElement).toBe(root);
    // The Escape stopped at the popover: the canvas's Escape (deselect) never heard it.
    expect(outer.mock.calls.filter(([event]) => (event as KeyboardEvent).key === 'Escape')).toEqual(
      [],
    );
    window.removeEventListener('keydown', outer);
    expect(screen.getByRole('toolbar', { name: 'Selection' })).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('in the live shell (a root that takes no focus), Escape leaves focus on nothing: the canvas has the keys', () => {
    const engine = engineWithRect();
    render(
      <div data-whiteboard-chrome="floating">
        <main aria-label="Canvas">
          <canvas />
          <SelectionPopover {...propsOf(engine)} />
        </main>
      </div>,
    );
    runFrames();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Tab' });
    const more = firstControl();
    expect(document.activeElement).toBe(more);
    fireEvent.keyDown(more, { key: 'Escape' });
    expect(document.activeElement).toBe(document.body);
    // The next Escape is the canvas's: it reaches the window's shortcuts.
    const canvasKeys = vi.fn();
    window.addEventListener('keydown', canvasKeys);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    window.removeEventListener('keydown', canvasKeys);
    expect(canvasKeys).toHaveBeenCalledOnce();
  });

  it('leaves Tab alone from a control, with a modifier, or while the popover is hidden', () => {
    const engine = engineWithRect();
    render(
      <Shell>
        <input aria-label="Name" />
        <SelectionPopover {...propsOf(engine)} />
      </Shell>,
    );
    const root = screen.getByTestId('root');
    root.focus();
    // Not placed yet: hidden, so Tab is the browser's.
    fireEvent.keyDown(root, { key: 'Tab' });
    expect(document.activeElement).toBe(root);
    runFrames();
    fireEvent.keyDown(root, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(root);
    const name = screen.getByRole('textbox', { name: 'Name' });
    name.focus();
    fireEvent.keyDown(name, { key: 'Tab' });
    expect(document.activeElement).toBe(name);
  });
});

describe('SelectionPopover comments', () => {
  it('gives an editor Comment and More, and a commenter Comment alone', () => {
    const engine = engineWithRect();
    const place = vi.fn<(placement: CommentPlacement) => void>();
    const { data, mode } = comments({ place });
    const { rerender } = render(
      <commentContext.Provider value={mode}>
        <commentDataContext.Provider value={data}>
          <SelectionPopover {...propsOf(engine)} />
        </commentDataContext.Provider>
      </commentContext.Provider>,
    );
    expect(screen.getByRole('button', { name: 'Comment', hidden: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More', hidden: true })).toBeTruthy();
    rerender(
      <commentContext.Provider value={mode}>
        <commentDataContext.Provider value={data}>
          <SelectionPopover {...propsOf(engine, { canEdit: false })} />
        </commentDataContext.Provider>
      </commentContext.Provider>,
    );
    // A commenter's Comment places a comment, as an editor's (the pin is the service's).
    fireEvent.click(screen.getByRole('button', { name: 'Comment', hidden: true }));
    expect(place).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'More', hidden: true })).toBeNull();
    // A viewer: no popover.
    rerender(
      <commentContext.Provider value={{ ...mode, canWrite: false }}>
        <commentDataContext.Provider value={data}>
          <SelectionPopover {...propsOf(engine, { canEdit: false })} />
        </commentDataContext.Provider>
      </commentContext.Provider>,
    );
    expect(screen.queryByRole('toolbar', { hidden: true })).toBeNull();
  });

  it('Comment opens a composer for a pin on the selected object', () => {
    const engine = engineWithRect();
    const place = vi.fn<(placement: CommentPlacement) => void>();
    const { data, mode } = comments({ place });
    render(
      <commentContext.Provider value={mode}>
        <commentDataContext.Provider value={data}>
          <SelectionPopover {...propsOf(engine)} />
        </commentDataContext.Provider>
      </commentContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Comment', hidden: true }));
    expect(place).toHaveBeenCalledOnce();
    const placement = place.mock.calls[0]?.[0];
    expect(placement?.point).toEqual({ x: 450, y: 325 });
  });

  it('a thread opening closes the popover and clears the selection', () => {
    const engine = engineWithRect();
    const { data, mode } = comments();
    const { rerender } = render(
      <commentContext.Provider value={mode}>
        <commentDataContext.Provider value={data}>
          <SelectionPopover {...propsOf(engine)} />
        </commentDataContext.Provider>
      </commentContext.Provider>,
    );
    expect(engine.board.state().selectedIds).toEqual([RECT.id]);
    rerender(
      <commentContext.Provider value={mode}>
        <commentDataContext.Provider value={{ ...data, selectedId: 'thread-1' }}>
          <SelectionPopover {...propsOf(engine)} />
        </commentDataContext.Provider>
      </commentContext.Provider>,
    );
    expect(screen.queryByRole('toolbar', { hidden: true })).toBeNull();
    expect(engine.board.state().selectedIds).toEqual([]);
  });
});

describe('SelectionPopover focus requests (mod+/)', () => {
  it('takes focus on a new request while it shows, not for the count it mounts with', () => {
    const engine = engineWithRect();
    const { rerender } = render(
      <Shell>
        <SelectionPopover {...propsOf(engine, { focusRequests: 3 })} />
      </Shell>,
    );
    runFrames();
    const first = document.querySelector<HTMLElement>('[data-selection-popover-layer] button');
    expect(first).not.toBeNull();
    expect(document.activeElement).not.toBe(first);
    rerender(
      <Shell>
        <SelectionPopover {...propsOf(engine, { focusRequests: 4 })} />
      </Shell>,
    );
    expect(document.activeElement).toBe(first);
  });

  it('does nothing for a request while it is hidden', () => {
    const engine = engineWithRect();
    const { rerender } = render(
      <Shell>
        <SelectionPopover {...propsOf(engine, { selection: [], focusRequests: 0 })} />
      </Shell>,
    );
    rerender(
      <Shell>
        <SelectionPopover {...propsOf(engine, { selection: [], focusRequests: 1 })} />
      </Shell>,
    );
    expect(document.activeElement).toBe(document.body);
  });
});
