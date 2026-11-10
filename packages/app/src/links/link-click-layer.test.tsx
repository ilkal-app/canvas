// @vitest-environment jsdom
// The canvas's link chip and hand cursor: a plain click or a tap on a link with the
// select tool shows the chip where the camera shows the link, and it closes on a press elsewhere,
// a selection off its object, a change to the object and another tool; a mouse over a link marks
// the canvas for the hand cursor.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';
import type { ToolId } from '@canvas/tools';

import { createCameraSource } from '../editing/camera-source.js';
import type { BoardViewChange } from '../engine/board-view.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import type { ShellAction } from '../state/shell-action.js';

import { LINK_CHIP_GAP_PX, LinkClickLayer, type LinkClickLayerProps } from './link-click-layer.js';

const LINK = 'https://example.com/note';
const NOTE = { id: 'note' as ObjectId, type: 'image', link: LINK } as unknown as BoardObject;
const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
const GENUINE = { isGenuine: () => true, isOver: () => true };

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * An engine whose board finds `hit` under every point and holds the note, with a change feed.
 *
 * @param hit - What the board finds, topmost first.
 * @returns The engine and what tells its listeners.
 */
function engineWith(hit: readonly ObjectId[]) {
  const listeners = new Set<(change: BoardViewChange) => void>();
  let selectedIds: readonly ObjectId[] = [NOTE.id];
  const engine = {
    camera: () => CAMERA,
    board: {
      idsAt: () => hit,
      board: { get: (id: ObjectId) => (id === NOTE.id ? NOTE : undefined) },
      state: () => ({ documentVersion: 0, selectedIds, enteredGroupId: null }),
      subscribe: (listener: (change: BoardViewChange) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  } as unknown as MountedEngine;
  const tell = (change: BoardViewChange, selection?: readonly ObjectId[]): void => {
    if (selection !== undefined) selectedIds = selection;
    act(() => {
      for (const listener of listeners) listener(change);
    });
  };
  return { engine, tell };
}

/**
 * The layer in a canvas mount.
 *
 * @param props - The layer's props.
 * @returns The mount.
 */
function Mount(props: LinkClickLayerProps): ReactElement {
  return (
    <main>
      <canvas data-testid="canvas" />
      <LinkClickLayer {...props} />
    </main>
  );
}

/**
 * Renders the layer over an engine.
 *
 * @param overrides - Props to change.
 * @param hit - What the board finds under every point.
 * @returns The canvas, the dispatch spy, the rerender and the change feed.
 */
function mount(overrides: Partial<LinkClickLayerProps> = {}, hit: readonly ObjectId[] = [NOTE.id]) {
  const { engine, tell } = engineWith(hit);
  const camera = createCameraSource();
  camera.write(CAMERA);
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const props = { engine, camera, canEdit: true, dispatch, gate: GENUINE, ...overrides };
  const view = render(<Mount {...props} />);
  const rerender = (tool: ToolId): void => {
    view.rerender(<Mount {...props} activeTool={tool} />);
  };
  return { canvas: screen.getByTestId('canvas'), dispatch, rerender, tell };
}

/**
 * A plain press and release on the canvas.
 *
 * @param canvas - The canvas.
 * @param pointerType - The pointer.
 */
function click(canvas: Element, pointerType = 'mouse'): void {
  fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 40, clientY: 30, pointerType });
  fireEvent.pointerUp(canvas, { pointerId: 1, buttons: 0, clientX: 40, clientY: 30, pointerType });
}

const chip = (): HTMLElement | null => document.querySelector('[data-link-chip]');

describe('LinkClickLayer chip', () => {
  it('shows the chip under a clicked link, where the camera shows it, opening nothing', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { canvas } = mount();
    click(canvas);
    const shown = chip();
    expect(shown?.style.left).toBe('40px');
    expect(shown?.style.top).toBe(`${String(30 + LINK_CHIP_GAP_PX)}px`);
    expect(shown?.hasAttribute('data-touch')).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("gives a finger's tap the touch chip", () => {
    const { canvas } = mount();
    click(canvas, 'touch');
    expect(chip()?.hasAttribute('data-touch')).toBe(true);
  });

  it('shows nothing for a click off every link', () => {
    const { canvas } = mount({}, []);
    click(canvas);
    expect(chip()).toBeNull();
  });

  it('shows nothing with another tool', () => {
    const { canvas } = mount({ activeTool: 'pen' });
    click(canvas);
    expect(chip()).toBeNull();
  });

  it("removes the object's own link from the chip as one restyle", () => {
    const { canvas, dispatch } = mount();
    click(canvas);
    fireEvent.click(screen.getByRole('button', { name: 'Edit link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [{ id: NOTE.id, style: { link: undefined } }],
    });
  });

  it('offers no Edit to a person who cannot edit', () => {
    const { canvas } = mount({ canEdit: false });
    click(canvas);
    expect(screen.queryByRole('button', { name: 'Edit link' })).toBeNull();
  });

  it('closes on a press elsewhere on the canvas', () => {
    const { canvas } = mount();
    click(canvas);
    fireEvent.pointerDown(canvas, { pointerId: 2, button: 0 });
    expect(chip()).toBeNull();
  });

  it('closes when the selection leaves its object, or the object changes', () => {
    const { canvas, tell } = mount();
    click(canvas);
    tell({ kind: 'selection' }, [NOTE.id]);
    expect(chip()).not.toBeNull();
    tell({ kind: 'selection' }, []);
    expect(chip()).toBeNull();
    click(canvas);
    const changes = { originKind: 'user', created: [], updated: [NOTE.id], deleted: [] };
    tell({ kind: 'document', changes } as unknown as BoardViewChange);
    expect(chip()).toBeNull();
  });

  it('closes when another tool takes over (editing the text)', () => {
    const { canvas, rerender } = mount();
    click(canvas);
    rerender('text');
    expect(chip()).toBeNull();
  });

  it('copies the link and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onNotice = vi.fn();
    const { canvas } = mount({ onNotice });
    click(canvas);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(LINK);
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Link copied');
  });

  it('says so when the clipboard refuses', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('denied')));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onNotice = vi.fn();
    const { canvas } = mount({ onNotice });
    click(canvas);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('The link could not be copied.');
  });
});

describe('LinkClickLayer hand cursor', () => {
  /**
   * Moves a pointer over the canvas and runs the frame.
   *
   * @param canvas - The canvas.
   * @param fields - The move's fields.
   */
  function move(canvas: Element, fields: Record<string, unknown>): void {
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 30, buttons: 0, ...fields });
    const due = frames;
    frames = [];
    act(() => {
      for (const frame of due) frame(0);
    });
  }

  it('marks the canvas while a mouse is over a link, and clears it on leaving', () => {
    const { canvas } = mount();
    move(canvas, { pointerType: 'mouse' });
    expect(canvas.classList.length).toBe(1);
    fireEvent.pointerLeave(canvas);
    expect(canvas.classList.length).toBe(0);
  });

  it('marks nothing for a finger, a drag, or off a link', () => {
    const { canvas } = mount();
    move(canvas, { pointerType: 'touch' });
    move(canvas, { pointerType: 'mouse', buttons: 1 });
    expect(canvas.classList.length).toBe(0);
    cleanup();
    const off = mount({}, []);
    move(off.canvas, { pointerType: 'mouse' });
    expect(off.canvas.classList.length).toBe(0);
  });

  it('marks nothing with another tool', () => {
    const { canvas } = mount({ activeTool: 'pen' });
    move(canvas, { pointerType: 'mouse' });
    expect(canvas.classList.length).toBe(0);
  });
});
