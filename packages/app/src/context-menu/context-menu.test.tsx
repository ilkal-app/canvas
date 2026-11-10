// @vitest-environment jsdom
// Right-click and long-press with real input, keyboard navigation and a chosen entry running its
// action: tooling/scenario/specs/app/context-menu.spec.ts and specs/tools/touch.spec.ts.
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useShortcuts } from '../hooks/use-shortcuts.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';

import { contextMenuSections } from './context-menu-entries.js';
import { ContextMenu } from './context-menu.js';

function renderMenu(count = 2) {
  const registry = createDefaultShortcutRegistry('mac');
  const sections = contextMenuSections(registry, { count, hasGroup: false });
  const onChoose = vi.fn();
  const onClose = vi.fn();
  const outside = document.createElement('button');
  document.body.append(outside);
  outside.focus();
  render(
    <ContextMenu
      sections={sections}
      position={{ clientX: 40, clientY: 30 }}
      platform="mac"
      onChoose={onChoose}
      onClose={onClose}
    />,
  );
  return { menu: screen.getByRole('menu', { name: 'Canvas' }), onChoose, onClose, outside };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('ContextMenu', () => {
  it('lists the entries as menu items with their chords, sections apart', () => {
    const { menu } = renderMenu(1);
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.firstChild?.textContent)).toEqual([
      'Select all of the same type',
      'Delete',
      'Duplicate',
      'Copy',
      'Cut',
      'Lock or unlock',
      'Create component',
      'Bring forward',
      'Send backward',
      'Bring to front',
      'Send to back',
    ]);
    expect(screen.getByRole('menuitem', { name: /Duplicate/ }).textContent).toBe('Duplicate⌘D');
    expect(
      screen.getByRole('menuitem', { name: /Duplicate/ }).getAttribute('aria-keyshortcuts'),
    ).toBe('Meta+D');
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(menu.style.left).toBe('40px');
  });

  it('focuses the first entry and moves with the arrows, Home and End, wrapping', () => {
    const { menu } = renderMenu(1);
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items.at(-1));
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(items.at(-1));
  });

  it('dispatches the chosen entry’s action and closes', () => {
    const { onChoose, onClose } = renderMenu(2);
    fireEvent.click(screen.getByRole('menuitem', { name: /Group/ }));
    expect(onChoose).toHaveBeenCalledWith({ type: 'arrange', command: 'group' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps Enter and Space on the focused entry, away from the canvas shortcuts', () => {
    const dispatch = vi.fn();
    renderHook(() => {
      useShortcuts(createDefaultShortcutRegistry('mac'), dispatch);
    });
    renderMenu();
    const [first] = screen.getAllByRole('menuitem');
    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      first?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('closes on Escape, marking the key handled so it does not deselect too', () => {
    const { menu, onClose } = renderMenu();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    menu.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on Tab and on a press outside, not on a press inside', () => {
    const { menu, onClose, outside } = renderMenu();
    fireEvent.pointerDown(screen.getAllByRole('menuitem')[0] ?? menu);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(outside);
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.keyDown(menu, { key: 'Tab' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps the browser’s own menu off the menu', () => {
    const { menu } = renderMenu();
    const rightClick = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    menu.dispatchEvent(rightClick);
    expect(rightClick.defaultPrevented).toBe(true);
  });

  it('returns focus where it was when it closes', () => {
    const { outside } = renderMenu();
    expect(document.activeElement).not.toBe(outside);
    cleanup();
    expect(document.activeElement).toBe(outside);
  });
});
