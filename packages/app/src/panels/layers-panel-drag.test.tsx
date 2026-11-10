// @vitest-environment jsdom
// The layers panel's drag and drop and move keys over the demo board. jsdom lays
// nothing out, so the rows' element starts at client y 0 and row n spans 28n to 28n + 28. In
// Chrome: tooling/scenario/specs/app/layers-drag.spec.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createDemoDocument, LOCAL_USER_ORIGIN } from '../engine/demo-document.js';
import { DocumentBoardView } from '../engine/document-board-view.js';
import type { ShellAction } from '../state/shell-action.js';

import { LayersPanel } from './layers-panel.js';

/** Listed top first: Section 4, 3, 2, 1, rows 0 to 3. */
const SECTION_1 = 'section-0' as ObjectId;
const SECTION_2 = 'section-1' as ObjectId;
const SECTION_3 = 'section-2' as ObjectId;
const SECTION_4 = 'section-3' as ObjectId;
const ROW_PX = 28;

beforeEach(() => {
  // jsdom has no pointer capture.
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
});

afterEach(cleanup);

function setUp(canEdit = true, selected: readonly ObjectId[] = []) {
  const store = createDemoDocument();
  let ids: readonly ObjectId[] = [];
  const view = new DocumentBoardView(store, {
    ids: () => ids,
    select: (next) => {
      ids = [...next];
    },
  });
  view.select(selected);
  const dispatch = vi.fn<(action: ShellAction) => void>();
  render(
    <LayersPanel
      view={view}
      selectedIds={view.state().selectedIds}
      dispatch={dispatch}
      canEdit={canEdit}
    />,
  );
  return { store, view, dispatch };
}

const rowNamed = (name: string) => screen.getByRole('treeitem', { name });
const indicator = () => document.querySelector('[data-drop-indicator]');

/**
 * Presses a row and drags to a client y over the list.
 *
 * @param name - The row pressed.
 * @param clientY - Where the pointer moves to.
 */
function dragTo(name: string, clientY: number): void {
  const row = rowNamed(name);
  fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientX: 40, clientY: 100 });
  fireEvent.pointerMove(row, { pointerId: 1, clientX: 40, clientY: 90 });
  fireEvent.pointerMove(row, { pointerId: 1, clientX: 40, clientY });
}

/**
 * Releases the pointer and the click that follows.
 *
 * @param name - The row pressed.
 */
function release(name: string): void {
  const row = rowNamed(name);
  fireEvent.pointerUp(row, { pointerId: 1, button: 0 });
  fireEvent.click(row);
}

describe('LayersPanel drag and drop', () => {
  it('drags a row above the top row: on top of the root, one action', () => {
    const { view, dispatch } = setUp();
    dragTo('Section 1', 2);
    expect(view.state().selectedIds).toEqual([SECTION_1]);
    expect(indicator()?.getAttribute('data-drop-indicator')).toBe('line');
    release('Section 1');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'placeLayers',
      ids: [SECTION_1],
      parentId: null,
    });
    expect(indicator()).toBeNull();
    expect(view.state().selectedIds).toEqual([SECTION_1]);
  });

  it('drags every selected row when a selected row is pressed, the selection kept', () => {
    const { view, dispatch } = setUp(true, [SECTION_2, SECTION_1]);
    dragTo('Section 1', 2);
    release('Section 1');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'placeLayers',
      ids: [SECTION_2, SECTION_1],
      parentId: null,
    });
    expect(view.state().selectedIds).toEqual([SECTION_2, SECTION_1]);
  });

  it('drags a selected frame without its selected child, which moves with it', () => {
    const child = 'section-0-rect-9-6' as ObjectId;
    const { dispatch } = setUp(true, [child, SECTION_1]);
    dragTo('Section 1', ROW_PX + ROW_PX / 2);
    release('Section 1');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'placeLayers',
      ids: [SECTION_1],
      parentId: SECTION_3,
    });
  });

  it('drags a row onto the middle of a frame: into it, outlined', () => {
    const { dispatch } = setUp();
    dragTo('Section 1', ROW_PX + ROW_PX / 2);
    expect(indicator()?.getAttribute('data-drop-indicator')).toBe('into');
    release('Section 1');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'placeLayers',
      ids: [SECTION_1],
      parentId: SECTION_3,
    });
  });

  it('refuses a drop onto a locked frame, visibly, and dispatches nothing', () => {
    const { store, dispatch } = setUp();
    act(() => {
      store.transact(LOCAL_USER_ORIGIN, (transaction) => {
        transaction.patchObject(SECTION_3, { locked: true });
      });
    });
    dragTo('Section 1', ROW_PX + ROW_PX / 2);
    expect(indicator()?.hasAttribute('data-refused')).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('“Section 3” is locked');
    release('Section 1');
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('ends a drag with Escape, dropping nothing', () => {
    const { dispatch } = setUp();
    dragTo('Section 1', 2);
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'Escape' });
    expect(indicator()).toBeNull();
    release('Section 1');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not drag on a short press, which stays a click', () => {
    const { view, dispatch } = setUp();
    const row = rowNamed('Section 1');
    fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientX: 40, clientY: 100 });
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 41, clientY: 101 });
    release('Section 1');
    expect(dispatch).not.toHaveBeenCalled();
    expect(view.state().selectedIds).toEqual([SECTION_1]);
  });
});

describe('LayersPanel move keys', () => {
  it('moves the focused row below the sibling below with Alt+Down', () => {
    const { dispatch } = setUp();
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowDown', altKey: true });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'placeLayers',
      ids: [SECTION_4],
      parentId: null,
      belowId: SECTION_3,
    });
  });
});

describe('LayersPanel for a person who cannot edit', () => {
  it('neither drags nor moves rows', () => {
    const { dispatch } = setUp(false);
    dragTo('Section 1', 2);
    expect(indicator()).toBeNull();
    release('Section 1');
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowDown', altKey: true });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
