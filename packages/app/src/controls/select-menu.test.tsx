// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SelectMenu } from './select-menu.js';
import selectCss from './select-menu.module.css?raw';

afterEach(cleanup);

const OPTIONS = [
  { value: 'editor', label: 'Can edit', description: 'Change anything on the board' },
  { value: 'commenter', label: 'Can comment', description: 'Comment, no edits' },
  { value: 'viewer', label: 'Can view', description: 'View and follow along' },
] as const;

type Value = (typeof OPTIONS)[number]['value'];

/**
 * A menu holding its own value, with an action and a key listener around it (as the dialog's).
 *
 * @param props - The handlers.
 * @param props.onChange - Receives a value chosen.
 * @param props.onRemove - The action.
 * @param props.onOuterKey - A key that reached the menu's container.
 * @returns The menu.
 */
function Harness(props: {
  readonly onChange: (value: Value) => void;
  readonly onRemove: () => void;
  readonly onOuterKey: (key: string) => void;
}): ReactElement {
  const [value, setValue] = useState<Value>('editor');
  return (
    <div
      onKeyDown={(event) => {
        props.onOuterKey(event.key);
      }}
    >
      <SelectMenu
        label="Role of Grace Hopper"
        value={value}
        options={OPTIONS}
        isDisabled={false}
        action={{ label: 'Remove access', onSelect: props.onRemove }}
        onChange={(next) => {
          setValue(next);
          props.onChange(next);
        }}
      />
      <button type="button">Elsewhere</button>
    </div>
  );
}

/**
 * Renders the harness.
 *
 * @returns The control and the handlers.
 */
function open() {
  const onChange = vi.fn<(value: Value) => void>();
  const onRemove = vi.fn<() => void>();
  const onOuterKey = vi.fn<(key: string) => void>();
  render(<Harness onChange={onChange} onRemove={onRemove} onOuterKey={onOuterKey} />);
  const control = screen.getByRole('combobox', { name: 'Role of Grace Hopper' });
  control.focus();
  return { control, onChange, onRemove, onOuterKey };
}

/**
 * The name of the item the control's active descendant points at.
 *
 * @param control - The control.
 * @returns The item's text.
 */
function activeItem(control: HTMLElement): string | null | undefined {
  const id = control.getAttribute('aria-activedescendant');
  return id === null ? undefined : document.getElementById(id)?.textContent;
}

describe('SelectMenu', () => {
  it('is a closed select-only combobox naming its value, with the value as its own', () => {
    const { control } = open();
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(control.getAttribute('aria-haspopup')).toBe('listbox');
    expect(control.textContent).toBe('Can edit');
    expect(control).toHaveProperty('value', 'editor');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens on Down at the value chosen, moves with the arrows, Home and End, without wrapping', () => {
    const { control } = open();
    fireEvent.keyDown(control, { key: 'ArrowDown' });
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox', { name: 'Role of Grace Hopper' })).toBeTruthy();
    expect(activeItem(control)).toMatch(/^Can edit/);
    fireEvent.keyDown(control, { key: 'ArrowUp' });
    expect(activeItem(control)).toMatch(/^Can edit/);
    fireEvent.keyDown(control, { key: 'ArrowDown' });
    expect(activeItem(control)).toMatch(/^Can comment/);
    fireEvent.keyDown(control, { key: 'End' });
    expect(activeItem(control)).toBe('Remove access');
    fireEvent.keyDown(control, { key: 'ArrowDown' });
    expect(activeItem(control)).toBe('Remove access');
    fireEvent.keyDown(control, { key: 'Home' });
    expect(activeItem(control)).toMatch(/^Can edit/);
    expect(document.activeElement).toBe(control);
  });

  it('chooses the active item with Enter and closes, and with Space', () => {
    const { control, onChange } = open();
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.keyDown(control, { key: 'ArrowDown' });
    fireEvent.keyDown(control, { key: 'ArrowDown' });
    fireEvent.keyDown(control, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('viewer');
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(control.textContent).toBe('Can view');
    fireEvent.keyDown(control, { key: ' ' });
    fireEvent.keyDown(control, { key: 'ArrowUp' });
    fireEvent.keyDown(control, { key: ' ' });
    expect(onChange).toHaveBeenLastCalledWith('commenter');
  });

  it('does not report the value already chosen', () => {
    const { control, onChange } = open();
    fireEvent.keyDown(control, { key: 'ArrowDown' });
    fireEvent.keyDown(control, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('runs its action when chosen', () => {
    const { control, onRemove, onChange } = open();
    fireEvent.keyDown(control, { key: 'End' });
    fireEvent.keyDown(control, { key: 'Enter' });
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on Escape without letting the key reach the dialog, which a closed menu does', () => {
    const { control, onOuterKey } = open();
    fireEvent.keyDown(control, { key: 'ArrowDown' });
    fireEvent.keyDown(control, { key: 'Escape' });
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(onOuterKey).not.toHaveBeenCalledWith('Escape');
    fireEvent.keyDown(control, { key: 'Escape' });
    expect(onOuterKey).toHaveBeenCalledWith('Escape');
  });

  it('closes on Tab and on a press outside, choosing nothing', () => {
    const { control, onChange } = open();
    fireEvent.keyDown(control, { key: 'ArrowDown' });
    fireEvent.keyDown(control, { key: 'ArrowDown' });
    fireEvent.keyDown(control, { key: 'Tab' });
    expect(control.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(control);
    expect(control.getAttribute('aria-expanded')).toBe('true');
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('chooses an item by pointer, the item under it active, focus kept on the control', () => {
    const { control, onChange } = open();
    fireEvent.click(control);
    const option = screen.getByRole('option', { name: 'Can comment' });
    fireEvent.mouseEnter(option);
    expect(activeItem(control)).toMatch(/^Can comment/);
    expect(fireEvent.mouseDown(option)).toBe(false);
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('commenter');
    expect(document.activeElement).toBe(control);
  });

  it('marks the value chosen and names each item by its label, described by its line', () => {
    const { control } = open();
    fireEvent.click(control);
    const comment = screen.getByRole('option', { name: 'Can comment' });
    expect(comment.getAttribute('aria-selected')).toBe('false');
    const description = comment.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(description)?.textContent).toBe('Comment, no edits');
    expect(screen.getByRole('option', { name: 'Can edit' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(control.getAttribute('aria-controls')).toBe(
      screen.getByRole('listbox').getAttribute('id'),
    );
  });

  it('opens upward when the window has no room below the control', () => {
    const { control } = open();
    vi.spyOn(control, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 500, y: window.innerHeight - 40, width: 100, height: 30 }),
    );
    fireEvent.click(control);
    const list = screen.getByRole('listbox');
    expect(list.style.bottom).not.toBe('');
    expect(list.style.top).toBe('');
  });

  it('draws the sheet’s states: closed, hover and open lifted, focus ringed, disabled at 38%', () => {
    const rulesFor = (fragment: string): string =>
      [...selectCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, selector = '']) => selector.includes(fragment))
        .map(([, , body = '']) => body)
        .join('\n');
    expect(selectCss).toMatch(
      /\.select \{[^}]*height: 30px;[^}]*border-radius: var\(--radius-sheet\);/,
    );
    const lifted = rulesFor(".select:hover:not(:disabled),\n.select[aria-expanded='true']");
    expect(lifted).toContain('background: var(--color-surface-raised)');
    expect(rulesFor('.select:focus-visible')).toContain(
      'outline: 2px solid var(--color-focus-ring)',
    );
    expect(rulesFor('.select:disabled')).toContain('opacity: 0.38');
    expect(rulesFor(".option[data-active='true']")).toContain(
      'background: var(--color-surface-pressed)',
    );
  });

  it('shows its chevron and the chosen item’s check as the shared 20 px icons', () => {
    const { control } = open();
    expect(control.querySelector('[data-icon="chevron-down"]')?.getAttribute('width')).toBe('20');
    fireEvent.keyDown(control, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox').querySelector('[data-icon="check"]')).not.toBeNull();
  });

  it('closes when the window scrolls or resizes and moves the control from under it', () => {
    const { control } = open();
    const wrapper = control.parentElement;
    if (wrapper === null) throw new Error('No wrapper.');
    let top = 0;
    vi.spyOn(wrapper, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, top, 120, 28),
    );
    fireEvent.keyDown(control, { key: 'ArrowDown' });
    expect(control.getAttribute('aria-expanded')).toBe('true');
    // A scroll that leaves the control in place (scroll anchoring) keeps it open.
    fireEvent.scroll(window);
    expect(control.getAttribute('aria-expanded')).toBe('true');
    top = 40;
    fireEvent.scroll(window);
    expect(control.getAttribute('aria-expanded')).toBe('false');
    // A resize closes it even in place: the list's offsets are the old viewport's.
    top = 0;
    fireEvent.keyDown(control, { key: 'ArrowDown' });
    fireEvent(window, new Event('resize'));
    expect(control.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps a typed letter that names no option, so it reaches no shortcut', () => {
    const { control } = open();
    fireEvent.keyDown(control, { key: 'ArrowDown' });
    const typed = new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true });
    control.dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(true);
    expect(control.getAttribute('aria-expanded')).toBe('true');
  });
});
