// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { commentDataContext, type CommentData } from '../comments/comment-data-context.js';
import { createCameraSource } from '../editing/camera-source.js';
import { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import { shellBoardModeContext, type ShellBoardMode } from '../shell/shell-board-mode.js';
import { whiteboardChromeContext } from '../shell/whiteboard-chrome.js';
import { panelLayoutFor } from '../state/dock-layout.js';

import {
  SelectionPopover,
  WhiteboardSelectionPopover,
  type SelectionPopoverProps,
} from './selection-popover.js';
import { POPOVER_SETTLE_MS } from './use-popover-placement.js';

const RECTANGLE = {
  id: 'shape' as ObjectId,
  parentId: null,
  rotation: 0,
  locked: false,
  createdBy: 'user:test',
  createdAt: 1,
  updatedAt: 1,
  x: 300,
  y: 250,
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
} as BoardObject;

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 };
const SHORTCUTS = createDefaultShortcutRegistry('mac');
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
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Runs the animation frames requested since the last call. */
function flushFrames(): void {
  const due = frames;
  frames = [];
  act(() => {
    for (const frame of due) frame(0);
  });
}

/**
 * A mounted engine with the selected shape stored in it.
 *
 * @returns The engine.
 */
function mountedEngine(): FakeMountedEngine {
  const store = new YjsDocumentStore({ clientId: 625 });
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    transaction.setObject(RECTANGLE);
  });
  const engine = new FakeMountedEngine(
    document.createElement('canvas'),
    { store },
    Promise.resolve(),
  );
  engine.currentCamera = CAMERA;
  return engine;
}

/**
 * Props for a selected object whose camera source has yet to report a frame.
 *
 * @param overrides - Values changed by the case.
 * @returns The popover props.
 */
function propsOf(overrides: Partial<SelectionPopoverProps> = {}): SelectionPopoverProps {
  return {
    engine: mountedEngine(),
    camera: createCameraSource(),
    selection: [RECTANGLE],
    canEdit: true,
    isEditingText: false,
    shortcuts: SHORTCUTS,
    dispatch: vi.fn(),
    ...overrides,
  };
}

describe('selection popover acceptance', () => {
  it('is mounted only for an editable floating whiteboard selection', () => {
    const mode: ShellBoardMode = {
      mode: 'whiteboard',
      changeMode: vi.fn(),
      drawers: panelLayoutFor('whiteboard', 'floating'),
    };
    const props = propsOf();
    const { rerender } = render(
      <main>
        <canvas />
        <WhiteboardSelectionPopover {...props} />
      </main>,
    );
    expect(screen.queryByRole('toolbar', { name: 'Selection', hidden: true })).toBeNull();
    rerender(
      <main>
        <canvas />
        <whiteboardChromeContext.Provider value="floating">
          <shellBoardModeContext.Provider value={mode}>
            <WhiteboardSelectionPopover {...props} />
          </shellBoardModeContext.Provider>
        </whiteboardChromeContext.Provider>
      </main>,
    );
    flushFrames();
    expect(screen.getByRole('toolbar', { name: 'Selection' }).dataset.shape).toBe('toolbar');
    rerender(
      <main>
        <canvas />
        <whiteboardChromeContext.Provider value="floating">
          <shellBoardModeContext.Provider value={mode}>
            <WhiteboardSelectionPopover {...props} canEdit={false} />
          </shellBoardModeContext.Provider>
        </whiteboardChromeContext.Provider>
      </main>,
    );
    expect(screen.queryByRole('toolbar', { hidden: true })).toBeNull();
    rerender(
      <main>
        <canvas />
        <whiteboardChromeContext.Provider value="floating">
          <shellBoardModeContext.Provider value={{ ...mode, mode: 'uiux' }}>
            <WhiteboardSelectionPopover {...props} />
          </shellBoardModeContext.Provider>
        </whiteboardChromeContext.Provider>
      </main>,
    );
    expect(screen.queryByRole('toolbar', { hidden: true })).toBeNull();
  });

  it('suppresses itself for text editing, empty selection and a pending comment placement', () => {
    const props = propsOf();
    const { rerender } = render(
      <main>
        <canvas />
        <SelectionPopover {...props} isEditingText />
      </main>,
    );
    expect(screen.queryByRole('toolbar', { hidden: true })).toBeNull();
    rerender(
      <main>
        <canvas />
        <SelectionPopover {...props} selection={[]} />
      </main>,
    );
    expect(screen.queryByRole('toolbar', { hidden: true })).toBeNull();
    const comment = {
      selectedId: undefined,
      placement: { x: 10, y: 10 },
    } as unknown as CommentData;
    rerender(
      <main>
        <canvas />
        <commentDataContext.Provider value={comment}>
          <SelectionPopover {...props} />
        </commentDataContext.Provider>
      </main>,
    );
    expect(screen.queryByRole('toolbar', { hidden: true })).toBeNull();
  });

  it('uses the engine camera initially, follows camera changes and hides through a canvas press', () => {
    vi.useFakeTimers();
    const props = propsOf();
    render(
      <main>
        <canvas data-testid="board-canvas" />
        <SelectionPopover {...props} />
      </main>,
    );
    flushFrames();
    const toolbar = screen.getByRole('toolbar', { name: 'Selection' });
    expect(toolbar.style.left).toMatch(/px$/);
    expect(toolbar.style.top).toMatch(/px$/);
    // Never a transform: it would capture the fixed popups opened from it.
    expect(toolbar.style.transform).toBe('');
    expect(toolbar.dataset.hidden).toBeUndefined();
    // Item 4: the camera moving no longer hides it; it follows the selection.
    act(() => {
      props.camera.write({ ...CAMERA, x: 10 });
    });
    expect(toolbar.dataset.hidden).toBeUndefined();
    flushFrames();
    expect(toolbar.dataset.hidden).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(POPOVER_SETTLE_MS);
    });
    expect(toolbar.dataset.hidden).toBeUndefined();
    fireEvent.pointerDown(screen.getByTestId('board-canvas'), { clientX: 100, clientY: 100 });
    // A press hides it once it is a drag, beyond 4 px.
    fireEvent.pointerMove(window, { clientX: 120, clientY: 100 });
    expect(toolbar.dataset.hidden).toBe('');
    fireEvent.pointerUp(window);
    flushFrames();
    expect(toolbar.dataset.hidden).toBeUndefined();
  });
});
