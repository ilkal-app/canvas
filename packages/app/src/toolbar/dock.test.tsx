// @vitest-environment jsdom
// The dock: the buttons per mode, their names, hints and pressed state, the disabled
// state, and the comment button. The flyouts and the keyboard:
// dock-keyboard.test.tsx. Rewritten from toolbar.test.tsx's tool tests, assertions kept.
import { cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BOARD_MODES } from '@canvas/schema';

import { createShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import { DOCK_LAYOUTS } from '../state/dock-layout.js';
import type { ShellAction } from '../state/shell-action.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';
import { ARROW_VARIANT, STAR_VARIANT, toolVariantAction } from '../state/tool-variants.js';

import { renderDock, tooltipOf, writer } from './__fixtures__/render-dock.js';
import { dockRoleOf } from './dock.js';

/**
 * The accessible names of the dock's buttons, in order.
 *
 * @param dock - The toolbar.
 * @returns The names.
 */
function namesIn(dock: HTMLElement): string[] {
  return within(dock)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? '');
}

/**
 * The accessible names of the dock's items (its buttons and its modes), in order.
 *
 * @param dock - The toolbar.
 * @returns The names.
 */
function itemNamesIn(dock: HTMLElement): string[] {
  return [...dock.querySelectorAll('[data-dock-item]')].map(
    (item) => item.getAttribute('aria-label') ?? '',
  );
}

afterEach(cleanup);

describe('Dock', () => {
  it('shows the mode’s tools in the dock table’s order, and no mode switcher', () => {
    const { dock } = renderDock({ comments: writer() });
    expect(namesIn(dock)).toEqual([
      'Select (V)',
      'Hand (H)',
      'Sticky note (S)',
      'Text (T)',
      'Shape: Rectangle (R)',
      'Line (L)',
      'Image (I)',
      'Pen (P)',
      'Comment',
    ]);
    expect(itemNamesIn(dock)).toHaveLength(9);
    expect(within(dock).queryAllByRole('radio')).toHaveLength(0);
  });

  it.each(BOARD_MODES)('shows every button of the %s mode', (mode) => {
    const { dock } = renderDock({ mode, comments: writer() });
    expect(within(dock).getAllByRole('button')).toHaveLength(DOCK_LAYOUTS[mode].length);
  });

  it('shows the UI / UX mode’s frame with its shortcut, and its tools not built yet disabled', () => {
    const { dock } = renderDock({ mode: 'uiux', comments: writer() });
    expect(namesIn(dock)).toEqual([
      'Select (V)',
      'Hand (H)',
      'Frame (F)',
      'Shape: Rectangle (R)',
      'Text (T)',
      'Image (I)',
      'Create component (⌥⌘K)',
      'Pen (P)',
      'Prototype — not available yet',
      'Comment',
    ]);
  });

  it.each([
    ['Select', 'V'],
    ['Hand', 'H'],
    ['Sticky note', 'S'],
    ['Text', 'T'],
    ['Shape: Rectangle', 'R'],
    ['Line', 'L'],
    ['Image', 'I'],
    ['Pen', 'P'],
  ])('shows the %s tool with its shortcut hint', (name, hint) => {
    const { dock } = renderDock();
    const button = within(dock).getByRole('button', { name: `${name} (${hint})` });
    expect(button.getAttribute('aria-keyshortcuts')).toBe(hint);
    expect(tooltipOf(button)).toContain(hint);
    expect(button.querySelector('svg')).toBeInstanceOf(SVGElement);
  });

  it('presses only the active tool', () => {
    const { dock } = renderDock({
      platform: 'other',
      state: { ...INITIAL_SHELL_STATE, activeTool: 'pen' },
    });
    const pressed = within(dock)
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true');
    expect(pressed.map((button) => button.getAttribute('aria-label'))).toEqual(['Pen (P)']);
  });

  it('selects a tool when its button is clicked', () => {
    const { dispatch, dock } = renderDock();
    fireEvent.click(within(dock).getByRole('button', { name: /Sticky note/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'selectTool', tool: 'sticky' });
  });

  it('names the lines group for the line tool’s variant and keeps the variant when clicked', () => {
    const { dispatch, dock } = renderDock({
      state: { ...INITIAL_SHELL_STATE, toolStyles: { line: { endCap: 'arrow' } } },
    });
    const button = within(dock).getByRole('button', { name: 'Line: Arrow (⇧L)' });
    expect(tooltipOf(button)).toBe('Arrow⇧L');
    fireEvent.click(button);
    expect(dispatch).toHaveBeenCalledWith(toolVariantAction(ARROW_VARIANT));
    expect(toolVariantAction(ARROW_VARIANT)).toEqual({
      type: 'selectTool',
      tool: 'line',
      style: { endCap: 'arrow' },
    });
  });

  it('names the shapes group for the kind in use, which a click chooses again', () => {
    const { dispatch, dock } = renderDock({
      state: { ...INITIAL_SHELL_STATE, toolStyles: { shape: { kind: 'star' } } },
    });
    const button = within(dock).getByRole('button', { name: 'Shape: Star' });
    expect(tooltipOf(button)).toBe('Star');
    fireEvent.click(button);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(toolVariantAction(STAR_VARIANT));
  });

  it('names the lines group Line for any end cap but an arrow', () => {
    const { dock } = renderDock({
      state: { ...INITIAL_SHELL_STATE, toolStyles: { line: { endCap: 'triangle' } } },
    });
    expect(within(dock).getByRole('button', { name: /^Line/ }).getAttribute('aria-label')).toBe(
      'Line (L)',
    );
  });

  it('shows the connector on the lines group once it was the last chosen', () => {
    const { dock } = renderDock({
      state: {
        ...INITIAL_SHELL_STATE,
        activeTool: 'connector',
        dockGroupTools: { shapes: 'shape', lines: 'connector' },
      },
    });
    const button = within(dock).getByRole('button', { name: 'Connector (C)' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('reselects the select tool when its pressed button is clicked again', () => {
    const { dispatch, dock } = renderDock();
    fireEvent.click(within(dock).getByRole('button', { name: /^Select/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'reselectTool', tool: 'select' });
  });

  it('keeps focus where it was when a tool is pressed with the mouse', () => {
    const { dock } = renderDock();
    const isNotCancelled = fireEvent.mouseDown(within(dock).getByRole('button', { name: /Pen/ }));
    expect(isNotCancelled).toBe(false);
  });

  it('has no undo or redo button: the shortcuts alone undo and redo', () => {
    const { dock } = renderDock({ comments: writer() });
    expect(within(dock).queryByRole('button', { name: /undo|redo/i })).toBeNull();
  });
});

describe('Dock availability', () => {
  it('makes a component of the selection from the component button', () => {
    const { dispatch, dock } = renderDock({ mode: 'uiux' });
    const button = within(dock).getByRole('button', { name: 'Create component (⌥⌘K)' });
    expect(button.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(button);
    expect(dispatch).toHaveBeenCalledWith({ type: 'arrange', command: 'createComponent' });
  });

  it.each(['prototype'])(
    'shows the %s button disabled, saying it is not available yet, and doing nothing',
    (id) => {
      const { dispatch, dock } = renderDock({ mode: 'uiux' });
      const label = id === 'prototype' ? 'Prototype' : id;
      const button = within(dock).getByRole('button', { name: `${label} — not available yet` });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(button.hasAttribute('disabled')).toBe(false);
      expect(tooltipOf(button)).toBe(`${label} — not available yet`);
      expect(tooltipOf(button)).not.toMatch(/VIV|20\d\d/);
      fireEvent.click(button);
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it('shows every motion tool disabled but the select tool, the hand and the comment button', () => {
    const { dock } = renderDock({ mode: 'motion', comments: writer() });
    const disabled = within(dock)
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-disabled') === 'true')
      .map((button) => button.getAttribute('aria-label'));
    expect(disabled).toEqual([
      'Keyframe — not available yet',
      'Motion path — not available yet',
      'Easing — not available yet',
      'Timeline — not available yet',
    ]);
  });

  it('says a tool the state leaves out is not available, whatever the registry says', () => {
    const { dock } = renderDock({ state: { ...INITIAL_SHELL_STATE, availableTools: [] } });
    const select = within(dock).getByRole('button', { name: /^Select/ });
    expect(select.getAttribute('aria-label')).toBe('Select — not available yet');
    expect(select.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows a tool without a shortcut without a hint', () => {
    const { dock } = renderDock({ registry: createShortcutRegistry<ShellAction>('mac') });
    const button = within(dock).getByRole('button', { name: 'Pen' });
    expect(tooltipOf(button)).toBe('Pen');
    expect(button.getAttribute('aria-keyshortcuts')).toBeNull();
  });
});

describe('Dock roles and comments', () => {
  it('gives a viewer no switcher and no creation tool: the select tool and the hand', () => {
    const { dock } = renderDock({
      state: { ...INITIAL_SHELL_STATE, canEdit: false },
      comments: { ...writer(), canWrite: false },
    });
    expect(namesIn(dock)).toEqual(['Select (V)', 'Hand (H)']);
    expect(within(dock).queryByRole('radiogroup', { name: 'Board mode' })).toBeNull();
  });

  it('gives a commenter no switcher: the select tool and the hand, no comment button yet', () => {
    for (const mode of ['whiteboard', 'motion'] as const) {
      const { dock } = renderDock({
        mode,
        state: { ...INITIAL_SHELL_STATE, canEdit: false },
        comments: writer(),
      });
      expect(namesIn(dock)).toEqual(['Select (V)', 'Hand (H)']);
      expect(within(dock).queryByRole('radiogroup', { name: 'Board mode' })).toBeNull();
      cleanup();
    }
  });

  it('derives the role from the editing right and the comment mode', () => {
    expect(dockRoleOf({ canEdit: true }, false)).toBe('editor');
    expect(dockRoleOf({ canEdit: true }, true)).toBe('editor');
    expect(dockRoleOf({ canEdit: false }, true)).toBe('commenter');
    expect(dockRoleOf({ canEdit: false }, false)).toBe('viewer');
  });

  it('shows the comment button to a writer only, pressed while placing, and toggles placing', () => {
    const setPlacing = vi.fn();
    const { dock } = renderDock({ comments: { ...writer(true), setPlacing } });
    const comment = within(dock).getByRole('button', { name: 'Comment' });
    expect(comment.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(comment);
    expect(setPlacing).toHaveBeenCalledWith(false);
    cleanup();
    expect(namesIn(renderDock().dock)).not.toContain('Comment');
  });

  it('leaves comment placement when another tool is chosen', () => {
    const setPlacing = vi.fn();
    const { dispatch, dock } = renderDock({ comments: { ...writer(true), setPlacing } });
    fireEvent.click(within(dock).getByRole('button', { name: /^Text/ }));
    expect(setPlacing).toHaveBeenCalledWith(false);
    expect(dispatch).toHaveBeenCalledWith({ type: 'selectTool', tool: 'text' });
  });

  it('does nothing on the shell’s state or the host’s mode when it renders', () => {
    const { dispatch, onModeChange } = renderDock({ mode: 'diagram' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(onModeChange).not.toHaveBeenCalled();
  });
});
