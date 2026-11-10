// @vitest-environment jsdom
// The layers panel over the demo board and a 50k-object board. In Chrome:
// tooling/scenario/specs/app/layers-panel.spec.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bringToFrontCommand, generateNKeysBetween, runCommand } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import type { BoardView } from '../engine/board-view.js';
import { createDemoDocument, LOCAL_USER_ORIGIN } from '../engine/demo-document.js';
import { DocumentBoardView } from '../engine/document-board-view.js';
import type { ShellAction } from '../state/shell-action.js';

import { createMemoryBoardView, memoryShape, memoryShapes } from './__fixtures__/memory-board.js';
import { USER_SCROLL_QUIET_MS } from './layers/use-layer-focus.js';
import { LayersPanel, selectionAfterRowClick } from './layers-panel.js';

const SECTION_0 = 'section-0' as ObjectId;
const SECTION_1 = 'section-1' as ObjectId;
const MARKER = 'section-0-rect-0-0' as ObjectId;
/** Section 1's top child: its last rectangle. */
const FIRST_CHILD = 'section-0-rect-9-6' as ObjectId;

afterEach(cleanup);

function demoView() {
  const store = createDemoDocument();
  let ids: readonly ObjectId[] = [];
  const view = new DocumentBoardView(store, {
    ids: () => ids,
    select: (next) => {
      ids = [...next];
    },
  });
  return { store, view };
}

function renderPanel(view: BoardView | undefined) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const panel = () => (
    <LayersPanel view={view} selectedIds={view?.state().selectedIds ?? []} dispatch={dispatch} />
  );
  const result = render(panel());
  const rerender = () => {
    result.rerender(panel());
  };
  return { dispatch, rerender, tree: () => screen.getByRole('tree', { name: 'Layers' }) };
}

const rowNamed = (name: string) => screen.getByRole('treeitem', { name });
const rowIds = () =>
  screen.queryAllByRole('treeitem').map((item) => item.getAttribute('data-id') ?? '');

describe('LayersPanel', () => {
  it('lists the board top first, frames collapsed, as a labelled tree', () => {
    renderPanel(demoView().view);
    expect(rowIds()).toEqual(['section-3', 'section-2', 'section-1', 'section-0']);
    const row = rowNamed('Section 1');
    expect(row.getAttribute('aria-level')).toBe('1');
    expect(row.getAttribute('aria-posinset')).toBe('4');
    expect(row.getAttribute('aria-setsize')).toBe('4');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(row.getAttribute('tabindex')).toBe('-1');
    expect(rowNamed('Section 4').getAttribute('tabindex')).toBe('0');
  });

  it('says so when there is no board yet', () => {
    renderPanel(undefined);
    expect(screen.getByText('The board is empty.')).toBeInstanceOf(HTMLElement);
    expect(rowIds()).toEqual([]);
  });

  it('selects a row on click, and adds or removes one with Shift', () => {
    const { view } = demoView();
    const { rerender } = renderPanel(view);
    fireEvent.click(rowNamed('Section 1'));
    expect(view.state().selectedIds).toEqual([SECTION_0]);
    rerender();
    expect(rowNamed('Section 1').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(rowNamed('Section 2'), { shiftKey: true });
    expect(view.state().selectedIds).toEqual([SECTION_0, SECTION_1]);
    rerender();
    fireEvent.click(rowNamed('Section 1'), { shiftKey: true });
    expect(view.state().selectedIds).toEqual([SECTION_1]);
  });

  it('expands and collapses a frame with its disclosure, without selecting it', () => {
    const { view } = demoView();
    renderPanel(view);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Section 1' }));
    expect(rowNamed('Section 1').getAttribute('aria-expanded')).toBe('true');
    expect(rowIds()).toContain(FIRST_CHILD);
    expect(view.state().selectedIds).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Section 1' }));
    expect(rowIds()).not.toContain(FIRST_CHILD);
  });

  it('renames a frame from its row with a double-click, as one rename action', () => {
    const { view } = demoView();
    const { dispatch } = renderPanel(view);
    fireEvent.doubleClick(rowNamed('Section 2'));
    const input = screen.getByRole('textbox', { name: 'Rename Section 2' });
    fireEvent.change(input, { target: { value: 'Pricing' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'component',
      command: 'rename',
      id: SECTION_1,
      name: 'Pricing',
    });
  });

  it('locks from a row by id, leaving the selection as it is', () => {
    const { view } = demoView();
    view.select([SECTION_0]);
    const { dispatch } = renderPanel(view);
    const lock = screen.getByRole('button', { name: 'Lock Section 2' });
    expect(lock.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(lock);
    expect(view.state().selectedIds).toEqual([SECTION_0]);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'toggleLockOf', ids: [SECTION_1] });
  });

  it('shows a locked object as locked, and follows a reorder', () => {
    const { store, view } = demoView();
    renderPanel(view);
    act(() => {
      store.transact(LOCAL_USER_ORIGIN, (transaction) => {
        transaction.patchObject(SECTION_1, { locked: true });
      });
    });
    expect(
      screen.getByRole('button', { name: 'Unlock Section 2' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('treeitem', { name: 'Section 2, locked' })).toBeInstanceOf(HTMLElement);
    act(() => {
      runCommand(
        store,
        LOCAL_USER_ORIGIN,
        bringToFrontCommand,
        { ids: [SECTION_0] },
        {
          clock: () => 1_790_000_000_000,
          createId: () => 'unused' as ObjectId,
        },
      );
    });
    expect(rowIds()[0]).toBe(SECTION_0);
  });

  it('moves with the arrow keys, expands with Right and selects with Enter', () => {
    const { view } = demoView();
    const { tree } = renderPanel(view);
    const first = rowNamed('Section 4');
    first.focus();
    fireEvent.keyDown(tree(), { key: 'End' });
    expect(document.activeElement).toBe(rowNamed('Section 1'));
    fireEvent.keyDown(tree(), { key: 'ArrowRight' });
    expect(rowNamed('Section 1').getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(tree(), { key: 'ArrowRight' });
    fireEvent.keyDown(tree(), { key: 'Enter' });
    expect(view.state().selectedIds).toEqual([FIRST_CHILD]);
    fireEvent.keyDown(tree(), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(rowNamed('Section 1'));
    fireEvent.keyDown(tree(), { key: 'x' });
  });

  it('marks the row of the group the select tool entered, and no other', () => {
    const { view } = demoView();
    render(
      <LayersPanel
        view={view}
        selectedIds={[]}
        enteredGroupId={'section-1' as ObjectId}
        dispatch={vi.fn()}
      />,
    );
    expect(rowNamed('Section 2').getAttribute('aria-current')).toBe('true');
    expect(rowNamed('Section 1').hasAttribute('aria-current')).toBe(false);
  });

  it('reveals the primary selection made elsewhere: expands its frame and scrolls to it', () => {
    const { view } = demoView();
    const { rerender, tree } = renderPanel(view);
    act(() => {
      view.select([MARKER]);
    });
    rerender();
    // Section 1 (row 3) is expanded, and its last child (row 73) scrolled to the bottom of view.
    expect(tree().scrollTop).toBe(74 * 28 - 480);
    expect(screen.getByRole('treeitem', { selected: true }).getAttribute('data-id')).toBe(MARKER);
    expect(screen.getByRole('treeitem', { selected: true }).getAttribute('tabindex')).toBe('0');
  });

  it('reveals the primary without scrolling while the person scrolls the list', () => {
    const { view } = demoView();
    const { rerender, tree } = renderPanel(view);
    const now = vi.spyOn(performance, 'now').mockReturnValue(10_000);
    tree().scrollTop = 56;
    fireEvent.scroll(tree());
    act(() => {
      view.select([MARKER]);
    });
    rerender();
    expect(tree().scrollTop).toBe(56);
    expect(rowNamed('Section 1').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('treeitem', { selected: true }).getAttribute('tabindex')).toBe('0');
    now.mockReturnValue(10_000 + USER_SCROLL_QUIET_MS);
    act(() => {
      view.select([]);
    });
    rerender();
    act(() => {
      view.select([MARKER]);
    });
    rerender();
    expect(tree().scrollTop).toBe(74 * 28 - 480);
    now.mockRestore();
  });
});

describe('LayersPanel on a 50k-object board', () => {
  it('renders only the rows in view, and the next ones after a scroll', () => {
    const view = createMemoryBoardView(memoryShapes(50_000));
    const { tree } = renderPanel(view);
    const rendered = screen.getAllByRole('treeitem');
    expect(rendered.length).toBeLessThan(40);
    expect(rendered[0]?.getAttribute('data-id')).toBe('shape-49999');
    expect(tree().querySelector('[role="none"]')?.getAttribute('style')).toContain(
      `height: ${String(50_000 * 28)}px`,
    );
    tree().scrollTop = 28 * 1_000;
    fireEvent.scroll(tree());
    const ids = rowIds();
    expect(ids).toContain('shape-48999');
    expect(ids.length).toBeLessThan(45);
    // The focus target stays rendered while scrolled away.
    expect(ids).toContain('shape-49999');
    expect(within(tree()).getAllByRole('treeitem')).toHaveLength(ids.length);
  });

  it("applies a collaborator's burst of change sets in one pass, at the next frame", () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((frame) => {
      frames.push(frame);
      return frames.length;
    });
    const shapes = memoryShapes(3);
    const view = createMemoryBoardView(shapes);
    renderPanel(view);
    const keys = generateNKeysBetween(shapes.at(-1)?.z ?? null, null, 1_000);
    act(() => {
      keys.forEach((z, index) => {
        const id = `pasted-${String(index)}` as ObjectId;
        view.objects.set(id, memoryShape(id, z));
        view.emit({ created: [id], updated: [], deleted: [] }, false);
      });
    });
    expect(rowIds()).toEqual(['shape-2', 'shape-1', 'shape-0']);
    expect(frames).toHaveLength(1);
    act(() => {
      frames[0]?.(0);
    });
    expect(rowIds()[0]).toBe('pasted-999');
    expect(
      screen.getByRole('tree').querySelector('[role="none"]')?.getAttribute('style'),
    ).toContain(`height: ${String(1_003 * 28)}px`);
    requestFrame.mockRestore();
  });

  it('follows a change set pushed by the board', () => {
    const view = createMemoryBoardView(memoryShapes(3));
    renderPanel(view);
    act(() => {
      view.objects.delete('shape-2' as ObjectId);
      view.emit({ created: [], updated: [], deleted: ['shape-2' as ObjectId] });
    });
    expect(rowIds()).toEqual(['shape-1', 'shape-0']);
  });
});

describe('selectionAfterRowClick', () => {
  const a = 'a' as ObjectId;
  const b = 'b' as ObjectId;

  it('selects the row alone, or adds or removes it with Shift', () => {
    expect(selectionAfterRowClick([a], b, false)).toEqual([b]);
    expect(selectionAfterRowClick([a], b, true)).toEqual([a, b]);
    expect(selectionAfterRowClick([a, b], a, true)).toEqual([b]);
  });
});
