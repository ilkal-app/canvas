// @vitest-environment jsdom
// The compact bottom bar and the undo pill below 768 px wide: the bar's
// entries and names, its flyouts (shapes and lines; the mode switcher went), the refusal while the
// live board loads, and every icon of the bar and the pill at 20 px with a 1.5 px stroke (UI-18's
// shared rule). In Chrome: tooling/scenario/specs/app/mobile-bar.spec.ts.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardMode } from '@canvas/schema';

import { commentContext, type CommentMode } from '../comments/comment-context.js';
import { ICON_SIZE_PX, ICON_STROKE_PX } from '../icons/icon.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import type { ShellAction } from '../state/shell-action.js';
import { INITIAL_SHELL_STATE, type ShellState } from '../state/shell-reducer.js';

import { writer } from './__fixtures__/render-dock.js';
import styles from './dock.module.css';
import { MobileBar } from './mobile-bar.js';
import { UndoPill } from './undo-pill.js';

afterEach(cleanup);

/**
 * Renders the bar alone.
 *
 * @param options - The state, mode, site comments and refusal.
 * @param options.state - The shell state.
 * @param options.mode - The board's mode.
 * @param options.comments - The site's comment mode.
 * @param options.refusal - Why editing is refused, if it is.
 * @returns The handlers and the toolbar.
 */
function renderBar(
  options: {
    readonly state?: ShellState;
    readonly mode?: BoardMode;
    readonly comments?: CommentMode;
    readonly refusal?: string;
  } = {},
) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const onModeChange = vi.fn<(mode: BoardMode) => void>();
  render(
    <commentContext.Provider value={options.comments}>
      <MobileBar
        registry={createDefaultShortcutRegistry('mac')}
        state={options.state ?? INITIAL_SHELL_STATE}
        mode={options.mode ?? 'whiteboard'}
        onModeChange={onModeChange}
        dispatch={dispatch}
        refusal={options.refusal}
      />
    </commentContext.Provider>,
  );
  return { dispatch, onModeChange, bar: screen.getByRole('toolbar', { name: 'Tools' }) };
}

/**
 * The accessible names of a toolbar's buttons, in order.
 *
 * @param bar - The toolbar.
 * @returns The names.
 */
function namesIn(bar: HTMLElement): string[] {
  return within(bar)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? '');
}

/**
 * Asserts every icon in an element is the shared 20 px icon with its 1.5 px stroke.
 *
 * @param element - The element.
 * @returns How many icons it holds.
 */
function expectSharedIcons(element: HTMLElement): number {
  const icons = [...element.querySelectorAll('svg')];
  for (const icon of icons) {
    expect(icon.getAttribute('width'), icon.dataset.icon).toBe(String(ICON_SIZE_PX));
    expect(icon.getAttribute('height'), icon.dataset.icon).toBe(String(ICON_SIZE_PX));
    expect(icon.querySelector('path')?.getAttribute('stroke-width')).toBe(String(ICON_STROKE_PX));
    expect(icon.querySelector('path')?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
  }
  return icons.length;
}

describe('MobileBar', () => {
  it('holds six buttons in order on the site: select, note, shapes, lines, pen, comment', () => {
    const { bar } = renderBar({ comments: writer() });
    expect(namesIn(bar)).toEqual([
      'Select (V)',
      'Sticky note (S)',
      'Shape: Rectangle (R)',
      'Line (L)',
      'Pen (P)',
      'Comment',
    ]);
    expect(bar.className).toBe(styles.compactBar);
  });

  it('draws every icon at the shared 20 px with a 1.5 px stroke (UI-18), never the dock’s 24 px', () => {
    const { bar } = renderBar({ comments: writer() });
    expect(expectSharedIcons(bar)).toBe(6);
    for (const button of within(bar).getAllByRole('button')) {
      expect(button.className).toBe(styles.compactButton);
    }
  });

  it('chooses a tool as the dock does', () => {
    const { bar, dispatch } = renderBar();
    fireEvent.click(within(bar).getByRole('button', { name: 'Sticky note (S)' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'selectTool', tool: 'sticky' });
  });

  it('opens the shapes and lines flyouts from their corner caret, as the dock does', () => {
    const { bar, dispatch } = renderBar();
    const shapes = within(bar).getByRole('button', { name: 'Shape: Rectangle (R)' });
    fireEvent.keyDown(shapes, { key: 'Enter' });
    const menu = within(bar).getByRole('menu', { name: 'Shapes' });
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /^Ellipse/ }));
    expect(dispatch).toHaveBeenCalled();
    expect(within(bar).queryByRole('menu')).toBeNull();
  });

  it('gives a viewer the select tool and the hand, and no mode button', () => {
    const { bar } = renderBar({ state: { ...INITIAL_SHELL_STATE, canEdit: false } });
    expect(namesIn(bar)).toEqual(['Select (V)', 'Hand (H)']);
  });

  it('while editing is refused, is dimmed and inert and says why', () => {
    const { bar } = renderBar({ refusal: 'Editing starts when the board is live' });
    expect(bar.hasAttribute('data-dimmed')).toBe(true);
    expect(bar.getAttribute('aria-disabled')).toBe('true');
    expect(bar.firstElementChild?.hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Editing starts when the board is live');
  });
});

describe('UndoPill', () => {
  it('dispatches undo and redo, named with their shortcuts, its icons the shared 20 px', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    render(<UndoPill registry={createDefaultShortcutRegistry('mac')} dispatch={dispatch} />);
    const pill = screen.getByRole('group', { name: 'History' });
    expect(expectSharedIcons(pill)).toBe(2);
    const undo = within(pill).getByRole('button', { name: 'Undo' });
    const redo = within(pill).getByRole('button', { name: 'Redo' });
    expect(undo.getAttribute('aria-keyshortcuts')).toBe('Meta+Z');
    expect(redo.getAttribute('aria-keyshortcuts')).toBe('Shift+Meta+Z');
    // A press keeps focus where it was (a text edit included).
    expect(fireEvent.mouseDown(undo)).toBe(false);
    fireEvent.click(undo);
    fireEvent.click(redo);
    expect(dispatch.mock.calls).toEqual([
      [{ type: 'history', command: 'undo' }],
      [{ type: 'history', command: 'redo' }],
    ]);
  });
});
