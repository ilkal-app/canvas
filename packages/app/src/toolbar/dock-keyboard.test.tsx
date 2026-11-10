// @vitest-environment jsdom
// The dock's flyouts and roving focus (the mode switcher went at the cutover). Real keyboard and pointer input in
// Chrome: tooling/scenario/specs/app/dock-*.spec.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';
import { ELLIPSE_VARIANT, toolVariantAction } from '../state/tool-variants.js';

import { renderDock } from './__fixtures__/render-dock.js';
import { FLYOUT_HOLD_MS } from './dock-button.js';
import { DockMenu } from './dock-menu.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * The shapes group's button.
 *
 * @param dock - The toolbar.
 * @returns The button.
 */
function shapesButton(dock: HTMLElement): HTMLElement {
  return within(dock).getByRole('button', { name: /^Shape:/ });
}

describe('a flyout', () => {
  it('opens on Enter with focus on the item in use, moves with the arrows, chooses with Enter', () => {
    const { dispatch, dock } = renderDock();
    const button = shapesButton(dock);
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    const menu = screen.getByRole('menu', { name: 'Shapes' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Rectangle (R)',
      'Ellipse (O)',
      'Triangle',
      'Polygon',
      'Star',
    ]);
    expect(document.activeElement).toBe(items[0]);
    expect(items[0]?.getAttribute('aria-checked')).toBe('true');
    expect(fireEvent.keyDown(document.activeElement ?? menu, { key: 'ArrowDown' })).toBe(false);
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document.activeElement ?? menu, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(toolVariantAction(ELLIPSE_VARIANT));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('opens on ArrowUp, wraps, and closes on Escape with focus back on its button', () => {
    const { dispatch, dock } = renderDock();
    const lines = within(dock).getByRole('button', { name: 'Line (L)' });
    lines.focus();
    fireEvent.keyDown(lines, { key: 'ArrowUp' });
    const menu = screen.getByRole('menu', { name: 'Lines' });
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.getAttribute('aria-label')),
    ).toEqual(['Line (L)', 'Arrow (⇧L)', 'Elbow connector', 'Connector (C)']);
    fireEvent.keyDown(document.activeElement ?? menu, { key: 'ArrowUp' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Connector (C)');
    expect(fireEvent.keyDown(document.activeElement ?? menu, { key: 'Escape' })).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(lines);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('opens from its corner caret, and a click on an item chooses it', () => {
    const { dispatch, dock } = renderDock();
    const caret = shapesButton(dock).parentElement?.querySelector(
      ':scope > span[aria-hidden="true"]',
    );
    expect(caret).toBeInstanceOf(HTMLElement);
    fireEvent.click(caret ?? dock);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Triangle' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'selectTool',
      tool: 'shape',
      style: { kind: 'polygon', sides: 3 },
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens on a press held, and the release then chooses nothing', () => {
    vi.useFakeTimers();
    const { dispatch, dock } = renderDock();
    const button = shapesButton(dock);
    fireEvent.pointerDown(button, { button: 0 });
    act(() => {
      vi.advanceTimersByTime(FLYOUT_HOLD_MS);
    });
    expect(screen.getByRole('menu', { name: 'Shapes' })).toBeInstanceOf(HTMLElement);
    fireEvent.pointerUp(button);
    fireEvent.click(button);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('closes on a press outside it', () => {
    const { dock } = renderDock();
    shapesButton(dock).focus();
    fireEvent.keyDown(shapesButton(dock), { key: 'Enter' });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the canvas’s shortcuts from keys pressed inside it, R and Delete included', () => {
    const { dispatch, dock } = renderDock();
    const shortcuts = vi.fn();
    window.addEventListener('keydown', shortcuts);
    try {
      const button = shapesButton(dock);
      button.focus();
      fireEvent.keyDown(button, { key: 'Enter' });
      const menu = screen.getByRole('menu', { name: 'Shapes' });
      for (const key of ['r', 'Delete', 'Backspace', 'v']) {
        fireEvent.keyDown(document.activeElement ?? menu, { key });
      }
      expect(shortcuts).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      expect(screen.getByRole('menu', { name: 'Shapes' })).toBe(menu);
    } finally {
      window.removeEventListener('keydown', shortcuts);
    }
  });

  it('a plain button opens nothing on Enter or ArrowUp', () => {
    const { dock } = renderDock();
    const pen = within(dock).getByRole('button', { name: 'Pen (P)' });
    expect(pen.getAttribute('aria-haspopup')).toBeNull();
    fireEvent.keyDown(pen, { key: 'ArrowUp' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('the dock’s roving focus', () => {
  it('is one tab stop; the arrows, Home and End move along it, disabled buttons included', () => {
    const { dock } = renderDock({ mode: 'uiux' });
    // Its tools only: the modes went with the switcher.
    const buttons = [...dock.querySelectorAll<HTMLElement>('[data-dock-item]')];
    expect(buttons.filter((button) => button.tabIndex === 0)).toEqual([buttons[0]]);
    buttons[0]?.focus();
    const press = (key: string): boolean =>
      fireEvent.keyDown(document.activeElement ?? dock, { key });
    expect(press('ArrowRight')).toBe(false);
    expect(document.activeElement).toBe(buttons[1]);
    press('End');
    expect(document.activeElement).toBe(buttons.at(-1));
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Prototype — not available yet',
    );
    press('ArrowLeft');
    press('ArrowLeft');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Create component (⌥⌘K)');
    expect(buttons.filter((button) => button.tabIndex === 0)).toEqual([document.activeElement]);
    press('Home');
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('keeps the tab stop on the button last focused across renders, else the first', () => {
    const { dock, view } = renderDock();
    const pen = within(dock).getByRole('button', { name: 'Pen (P)' });
    pen.focus();
    view.rerender(<></>);
    cleanup();
    const again = renderDock({ state: { ...INITIAL_SHELL_STATE, activeTool: 'pen' } });
    const first = within(again.dock).getAllByRole('button')[0];
    expect(first?.tabIndex).toBe(0);
  });
});

describe('a flyout’s edges', () => {
  it('moves to the ends with Home and End, ignores other keys, and closes on Tab', () => {
    const { dock } = renderDock();
    const button = within(dock).getByRole('button', { name: /^Shape:/ });
    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowUp' });
    const menu = screen.getByRole('menu', { name: 'Shapes' });
    const items = within(menu).getAllByRole('menuitemradio');
    fireEvent.keyDown(document.activeElement ?? menu, { key: 'End' });
    expect(document.activeElement).toBe(items.at(-1));
    fireEvent.keyDown(document.activeElement ?? menu, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
    expect(fireEvent.keyDown(document.activeElement ?? menu, { key: 'x' })).toBe(true);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement ?? menu, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes from its caret pressed again, focus back where it was before it opened', () => {
    const { dock } = renderDock();
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    const caret = within(dock)
      .getByRole('button', { name: /^Shape:/ })
      .parentElement?.querySelector(':scope > span[aria-hidden="true"]');
    fireEvent.click(caret ?? dock);
    expect(screen.getByRole('menu', { name: 'Shapes' })).toBeInstanceOf(HTMLElement);
    fireEvent.click(caret ?? dock);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(field);
    field.remove();
  });

  it('keeps a press inside its own slot from closing it', () => {
    const { dock } = renderDock();
    const button = within(dock).getByRole('button', { name: /^Shape:/ });
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.pointerDown(button);
    expect(screen.getByRole('menu', { name: 'Shapes' })).toBeInstanceOf(HTMLElement);
  });
});

describe('a press in the dock', () => {
  it('keeps focus where it was: the button, its caret and a flyout item take no focus on press', () => {
    const { dock } = renderDock();
    const button = shapesButton(dock);
    const caret = button.parentElement?.querySelector(':scope > span[aria-hidden="true"]');
    if (!(caret instanceof HTMLElement)) throw new Error('No caret on the shapes button.');
    expect(fireEvent.mouseDown(button)).toBe(false);
    expect(fireEvent.mouseDown(caret)).toBe(false);
    fireEvent.click(caret);
    const [item] = within(screen.getByRole('menu', { name: 'Shapes' })).getAllByRole(
      'menuitemradio',
    );
    if (item === undefined) throw new Error('No item in the shapes flyout.');
    expect(fireEvent.mouseDown(item)).toBe(false);
  });
});

describe('a menu item not built yet', () => {
  it('says so, and does nothing on a click, Enter or Space', () => {
    const onChoose = vi.fn();
    render(
      <DockMenu
        label="Test"
        items={[
          { id: 'eraser', label: 'Eraser', icon: 'eraser', isChecked: false, isAvailable: false },
        ]}
        onChoose={onChoose}
        onClose={vi.fn()}
      />,
    );
    const item = screen.getByRole('menuitemradio', { name: 'Eraser — not available yet' });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(item);
    fireEvent.click(item);
    fireEvent.keyDown(item, { key: 'Enter' });
    fireEvent.keyDown(item, { key: ' ' });
    fireEvent.keyDown(item, { key: 'a' });
    expect(onChoose).not.toHaveBeenCalled();
  });
});
