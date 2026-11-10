// @vitest-environment jsdom
// Keeping the selection and the text being edited clear of the compact chrome: the hook
// measures the page and scrolls the board by a wheel over the canvas, once per change, after a
// press in progress is lifted. In Chrome: tooling/scenario/specs/app/mobile-bar.spec.ts and
// mobile-format-bar.spec.ts.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useRef, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { MountedEngine } from '../engine/mounted-engine.js';
import { BOTTOM_CHROME_ATTRIBUTE } from '../toolbar/bottom-chrome.js';

import { createCameraSource } from './camera-source.js';
import { useKeepInView } from './use-keep-in-view.js';

const NOTE = 'note' as ObjectId;

/** A note at world (40, 700), 150 × 112: under the bar on a 844 px phone at 100%. */
const STICKY = {
  id: NOTE,
  type: 'sticky',
  parentId: null,
  x: 40,
  y: 700,
  rotation: 0,
  width: 150,
  height: 112,
  color: [1, 1, 1, 1],
} as unknown as BoardObject;

const ENGINE = {
  board: { board: { get: (id: ObjectId) => (id === NOTE ? STICKY : undefined) } },
} as unknown as MountedEngine;

/**
 * Gives an element a box, as jsdom lays nothing out.
 *
 * @param element - The element.
 * @param box - Its top and bottom, CSS px.
 * @param box.top - Its top.
 * @param box.bottom - Its bottom.
 */
function placeAt(element: Element, box: { readonly top: number; readonly bottom: number }): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: box.top,
    top: box.top,
    bottom: box.bottom,
    left: 0,
    right: 390,
    width: 390,
    height: box.bottom - box.top,
    toJSON: () => ({}),
  });
}

/** Props of {@link Workspace}. */
interface WorkspaceProps {
  readonly ids: readonly ObjectId[];
  readonly layoutKey: string;
  readonly isEnabled?: boolean;
}

const camera = createCameraSource();

/**
 * A workspace as the shell's: the canvas, the top bars and the bottom bar, the hook over it.
 *
 * @param props - The ids, the layout's key and whether it is on.
 * @returns The workspace.
 */
function Workspace(props: WorkspaceProps): ReactElement {
  const workspaceRef = useRef<HTMLDivElement>(null);
  useKeepInView({
    isEnabled: props.isEnabled ?? true,
    workspaceRef,
    engine: ENGINE,
    camera,
    ids: props.ids,
    layoutKey: props.layoutKey,
  });
  return (
    <div ref={workspaceRef}>
      <div data-top-bars="" />
      <canvas />
      <div {...{ [BOTTOM_CHROME_ATTRIBUTE]: '' }} />
    </div>
  );
}

/**
 * Renders the workspace laid out as on a 390 × 844 phone: the top bars 8–68, the bar 778–836.
 *
 * @param props - The ids and the layout's key.
 * @returns The render and the wheels its canvas received.
 * @throws {Error} When it did not render.
 */
function renderWorkspace(props: WorkspaceProps) {
  camera.write({ x: 0, y: 0, zoom: 1, viewportWidthPx: 390, viewportHeightPx: 844, dpr: 1 });
  const wheels: number[] = [];
  const view = render(<Workspace {...props} />);
  const [bars, canvas, bar] = view.container.firstElementChild?.children ?? [];
  if (bars === undefined || canvas === undefined || bar === undefined) {
    throw new Error('Not rendered.');
  }
  placeAt(bars, { top: 8, bottom: 68 });
  placeAt(canvas, { top: 0, bottom: 844 });
  placeAt(bar, { top: 778, bottom: 836 });
  canvas.addEventListener('wheel', (event) => wheels.push((event as WheelEvent).deltaY));
  return { ...view, wheels };
}

/**
 * Sends a pointer event of one pointer to the window, as a finger does.
 *
 * @param type - The event's type.
 * @param pointerId - The pointer.
 */
function pointer(type: 'pointerdown' | 'pointerup' | 'pointercancel', pointerId: number): void {
  window.dispatchEvent(Object.assign(new Event(type), { pointerId }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useKeepInView', () => {
  it('scrolls a selection under the bar up just clear of it, once per change', () => {
    const { wheels, rerender } = renderWorkspace({ ids: [], layoutKey: 'a' });
    expect(wheels).toEqual([]);
    rerender(<Workspace ids={[NOTE]} layoutKey="a" />);
    // The note's bottom (812) and the margin (16) above the bar's top less its gap (770).
    expect(wheels).toEqual([812 + 16 - (778 - 8)]);
    rerender(<Workspace ids={[NOTE]} layoutKey="a" />);
    expect(wheels).toHaveLength(1);
  });

  it('looks again when the layout changes (the keyboard, a sheet)', () => {
    const { wheels, rerender } = renderWorkspace({ ids: [], layoutKey: 'a' });
    rerender(<Workspace ids={[NOTE]} layoutKey="a" />);
    expect(wheels).toHaveLength(1);
    rerender(<Workspace ids={[NOTE]} layoutKey="b" />);
    expect(wheels).toHaveLength(2);
  });

  it('looks again when bottom chrome opens however it was asked for (a sheet)', async () => {
    const { wheels, rerender, container } = renderWorkspace({ ids: [], layoutKey: 'a' });
    rerender(<Workspace ids={[NOTE]} layoutKey="a" />);
    expect(wheels).toHaveLength(1);
    // A sheet, taller than the bar, opens with no layout key changed (its tool chosen again).
    const sheet = document.createElement('div');
    sheet.setAttribute(BOTTOM_CHROME_ATTRIBUTE, '');
    placeAt(sheet, { top: 600, bottom: 770 });
    await act(async () => {
      container.firstElementChild?.append(sheet);
      await Promise.resolve();
    });
    // Just clear of the sheet: the note's bottom (812) and the margin (16) above its top less
    // the gap (592).
    expect(wheels).toEqual([812 + 16 - (778 - 8), 812 + 16 - (600 - 8)]);
  });

  it('waits for a press in progress to lift before it scrolls', () => {
    const { wheels, rerender } = renderWorkspace({ ids: [], layoutKey: 'a' });
    act(() => {
      fireEvent.pointerDown(window);
    });
    rerender(<Workspace ids={[NOTE]} layoutKey="a" />);
    expect(wheels).toEqual([]);
    act(() => {
      fireEvent.pointerUp(window);
    });
    expect(wheels).toHaveLength(1);
    act(() => {
      fireEvent.pointerUp(window);
    });
    expect(wheels).toHaveLength(1);
  });

  it('waits for the last of several pointers to lift (a two-finger pan), or be cancelled', () => {
    const { wheels, rerender } = renderWorkspace({ ids: [], layoutKey: 'a' });
    act(() => {
      pointer('pointerdown', 1);
      pointer('pointerdown', 2);
    });
    rerender(<Workspace ids={[NOTE]} layoutKey="a" />);
    act(() => {
      pointer('pointerup', 1);
    });
    // The second finger is still down: nothing moves under it.
    expect(wheels).toEqual([]);
    act(() => {
      pointer('pointercancel', 2);
    });
    expect(wheels).toHaveLength(1);
  });

  it('does nothing while off, for objects in view, or for objects gone', () => {
    const { wheels, rerender } = renderWorkspace({ ids: [NOTE], layoutKey: 'a', isEnabled: false });
    expect(wheels).toEqual([]);
    camera.write({ x: 0, y: 400, zoom: 1, viewportWidthPx: 390, viewportHeightPx: 844, dpr: 1 });
    rerender(<Workspace ids={[NOTE]} layoutKey="b" />);
    expect(wheels).toEqual([]);
    rerender(<Workspace ids={['gone' as ObjectId]} layoutKey="b" />);
    expect(wheels).toEqual([]);
  });
});
