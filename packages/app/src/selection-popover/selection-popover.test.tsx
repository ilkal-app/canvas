// @vitest-environment jsdom
// The selection's popover: when it shows, its more menu, and how it follows the
// selection, hides for the camera and a press, and comes back. Geometry in a real browser is the
// scenario's (specs/app/selection-popover.spec.ts).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { commentDataContext, type CommentData } from '../comments/comment-data-context.js';
import { onAnchorsMoved } from '../controls/anchor-moves.js';
import { createCameraSource, type CameraSource } from '../editing/camera-source.js';
import { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import { fakeViewport } from '../shell/__fixtures__/fake-media.js';
import { shellBoardModeContext, type ShellBoardMode } from '../shell/shell-board-mode.js';
import { whiteboardChromeContext } from '../shell/whiteboard-chrome.js';
import { panelLayoutFor } from '../state/dock-layout.js';

import {
  SelectionPopover,
  WhiteboardSelectionPopover,
  type SelectionPopoverProps,
} from './selection-popover.js';
import { POPOVER_SETTLE_MS } from './use-popover-placement.js';

const SHORTCUTS = createDefaultShortcutRegistry('mac');

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
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
  return () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
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
 * The engine with the rectangle on its board, and a camera showing it at zoom 1.
 *
 * @returns The engine and the camera's source.
 */
function setUpBoard(): { engine: FakeMountedEngine; camera: CameraSource } {
  const store = new YjsDocumentStore({ clientId: 3 });
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    transaction.setObject(RECT);
  });
  const canvas = document.createElement('canvas');
  const engine = new FakeMountedEngine(canvas, { store }, Promise.resolve());
  const camera = createCameraSource();
  camera.write({ x: 0, y: 0, zoom: 1, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 });
  return { engine, camera };
}

/**
 * The popover's props, the selection being the rectangle.
 *
 * @param overrides - What differs.
 * @returns The props.
 */
function propsOf(overrides: Partial<SelectionPopoverProps> = {}): SelectionPopoverProps {
  return {
    engine: undefined,
    camera: createCameraSource(),
    selection: [RECT],
    canEdit: true,
    isEditingText: false,
    shortcuts: SHORTCUTS,
    dispatch: vi.fn(),
    ...overrides,
  };
}

/**
 * The canvas the popover sits over, as the shell's canvas mount has it.
 *
 * @param props - What it holds.
 * @param props.children - The popover.
 * @returns The mount.
 */
function Canvas(props: { readonly children: ReactNode }): ReactElement {
  return (
    <main aria-label="Canvas">
      <canvas data-testid="canvas" />
      {props.children}
    </main>
  );
}

describe('SelectionPopover', () => {
  it('shows a toolbar beside a selection to an editor, hidden until it is placed', () => {
    render(<SelectionPopover {...propsOf()} />);
    const popover = screen.getByRole('toolbar', { name: 'Selection', hidden: true });
    expect(popover.dataset.shape).toBe('toolbar');
    expect(popover.dataset.hidden).toBe('');
  });

  it('is not shown with nothing selected, to a viewer, while text is edited or a thread is open', () => {
    const { rerender } = render(<SelectionPopover {...propsOf({ selection: [] })} />);
    expect(screen.queryByRole('toolbar', { hidden: true })).toBeNull();
    rerender(<SelectionPopover {...propsOf({ canEdit: false })} />);
    expect(screen.queryByRole('toolbar', { hidden: true })).toBeNull();
    rerender(<SelectionPopover {...propsOf({ isEditingText: true })} />);
    expect(screen.queryByRole('toolbar', { hidden: true })).toBeNull();
    const thread = { selectedId: 'thread-1', placement: undefined } as unknown as CommentData;
    rerender(
      <commentDataContext.Provider value={thread}>
        <SelectionPopover {...propsOf()} />
      </commentDataContext.Provider>,
    );
    expect(screen.queryByRole('toolbar', { hidden: true })).toBeNull();
  });

  it('opens the more menu, whose item runs its action', () => {
    const dispatch = vi.fn();
    render(<SelectionPopover {...propsOf({ dispatch })} />);
    const more = screen.getByRole('button', { name: 'More', hidden: true });
    more.focus();
    fireEvent.click(more);
    const menu = screen.getByRole('menu', { name: 'More', hidden: true });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Duplicate/, hidden: true }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'selection', command: 'duplicate' });
  });

  it('places itself beside the selection and follows it through camera moves', () => {
    vi.useFakeTimers();
    const { engine, camera } = setUpBoard();
    render(
      <Canvas>
        <SelectionPopover {...propsOf({ engine, camera })} />
      </Canvas>,
    );
    runFrames();
    const popover = screen.getByRole('toolbar', { name: 'Selection' });
    expect(popover.dataset.hidden).toBeUndefined();
    expect(popover.style.left).toMatch(/px$/);
    expect(popover.style.top).toMatch(/px$/);
    // Never a transform: it would capture the fixed popups opened from it.
    expect(popover.style.transform).toBe('');
    expect(['top', 'bottom']).toContain(popover.dataset.side);
    const left = Number.parseFloat(popover.style.left);
    const top = Number.parseFloat(popover.style.top);
    const at = (x: number, y: number, zoom = 1): void => {
      act(() => {
        camera.write({ x, y, zoom, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 });
      });
    };
    // A pan: still shown, moved with the selection on the frame after, never hidden between.
    at(50, 20);
    expect(popover.dataset.hidden).toBeUndefined();
    runFrames();
    expect(popover.dataset.hidden).toBeUndefined();
    expect(Number.parseFloat(popover.style.left)).toBeCloseTo(left - 50);
    expect(Number.parseFloat(popover.style.top)).toBeCloseTo(top - 20);
    // Several cameras in one frame: one follow, at the last.
    at(60, 20);
    at(70, 20);
    runFrames();
    expect(Number.parseFloat(popover.style.left)).toBeCloseTo(left - 70);
    // The selection off screen: hidden, and back with it.
    at(100_000, 0);
    runFrames();
    expect(popover.dataset.hidden).toBe('');
    act(() => {
      vi.advanceTimersByTime(POPOVER_SETTLE_MS);
    });
    expect(popover.dataset.hidden).toBe('');
    // Back on screen: placed again once the camera stops.
    at(0, 0);
    runFrames();
    act(() => {
      vi.advanceTimersByTime(POPOVER_SETTLE_MS);
    });
    expect(popover.dataset.hidden).toBeUndefined();
    expect(Number.parseFloat(popover.style.left)).toBeCloseTo(left);
  });

  it('on a phone, keeps its sheet and lets its popups follow the selection through the camera', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', fakeViewport(390).matchMedia);
    const { engine, camera } = setUpBoard();
    const moves = vi.fn();
    const stop = onAnchorsMoved(moves);
    render(
      <Canvas>
        <SelectionPopover {...propsOf({ engine, camera })} />
      </Canvas>,
    );
    runFrames();
    const popover = screen.getByRole('toolbar', { name: 'Selection' });
    expect(popover.hasAttribute('data-sheet')).toBe(true);
    expect(popover.dataset.hidden).toBeUndefined();
    const placed = moves.mock.calls.length;
    expect(placed).toBeGreaterThan(0);
    act(() => {
      camera.write({ x: 40, y: 0, zoom: 1, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 });
    });
    runFrames();
    // The sheet stays where its stylesheet puts it; its popups are told the selection moved.
    expect(popover.style.left).toBe('');
    expect(moves.mock.calls.length).toBe(placed + 1);
    stop();
    vi.unstubAllGlobals();
  });

  it('places itself from the engine’s camera before the camera source has one', () => {
    const { engine } = setUpBoard();
    engine.currentCamera = {
      x: 0,
      y: 0,
      zoom: 1,
      viewportWidthPx: 1000,
      viewportHeightPx: 800,
      dpr: 1,
    };
    render(
      <Canvas>
        <SelectionPopover {...propsOf({ engine, camera: createCameraSource() })} />
      </Canvas>,
    );
    runFrames();
    const popover = screen.getByRole('toolbar', { name: 'Selection' });
    expect(popover.dataset.hidden).toBeUndefined();
    expect(popover.style.left).toMatch(/px$/);
    expect(popover.style.top).toMatch(/px$/);
    // Never a transform: it would capture the fixed popups opened from it.
    expect(popover.style.transform).toBe('');
  });

  it('hides while a drag on the canvas lasts and comes back on release', () => {
    const { engine, camera } = setUpBoard();
    render(
      <Canvas>
        <SelectionPopover {...propsOf({ engine, camera })} />
      </Canvas>,
    );
    runFrames();
    const popover = screen.getByRole('toolbar', { name: 'Selection' });
    fireEvent.pointerDown(screen.getByTestId('canvas'), { clientX: 100, clientY: 100 });
    // A press is a drag once it moves more than 4 px; a click leaves the popover.
    fireEvent.pointerMove(window, { clientX: 120, clientY: 100 });
    expect(popover.dataset.hidden).toBe('');
    runFrames();
    expect(popover.dataset.hidden).toBe('');
    fireEvent.pointerUp(window);
    runFrames();
    expect(popover.dataset.hidden).toBeUndefined();
  });

  it('follows a change to the document', () => {
    const { engine, camera } = setUpBoard();
    render(
      <Canvas>
        <SelectionPopover {...propsOf({ engine, camera })} />
      </Canvas>,
    );
    runFrames();
    const popover = screen.getByRole('toolbar', { name: 'Selection' });
    const before = `${popover.style.left} ${popover.style.top}`;
    act(() => {
      engine.store.transact(SYSTEM_ORIGIN, (transaction) => {
        transaction.setObject({ ...RECT, x: 600 });
      });
    });
    runFrames();
    expect(`${popover.style.left} ${popover.style.top}`).not.toBe(before);
  });
});

describe('WhiteboardSelectionPopover', () => {
  const whiteboard: ShellBoardMode = {
    mode: 'whiteboard',
    changeMode: vi.fn(),
    drawers: panelLayoutFor('whiteboard', 'floating'),
  };

  it('shows on a whiteboard under the floating chrome only', () => {
    const { rerender } = render(<WhiteboardSelectionPopover {...propsOf()} />);
    expect(screen.queryByRole('toolbar', { hidden: true })).toBeNull();
    rerender(
      <whiteboardChromeContext.Provider value="floating">
        <shellBoardModeContext.Provider value={whiteboard}>
          <WhiteboardSelectionPopover {...propsOf()} />
        </shellBoardModeContext.Provider>
      </whiteboardChromeContext.Provider>,
    );
    expect(screen.getByRole('toolbar', { name: 'Selection', hidden: true })).toBeTruthy();
    rerender(
      <whiteboardChromeContext.Provider value="floating">
        <shellBoardModeContext.Provider value={{ ...whiteboard, mode: 'uiux' }}>
          <WhiteboardSelectionPopover {...propsOf()} />
        </shellBoardModeContext.Provider>
      </whiteboardChromeContext.Provider>,
    );
    expect(screen.queryByRole('toolbar', { hidden: true })).toBeNull();
  });
});
