// @vitest-environment jsdom
// The floating text bar in jsdom (Figma "States" E1): where it shows, what its controls
// do, and its keys. In Chrome: tooling/scenario/specs/app/text-bar.spec.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';
import { NOTE_COLORS } from '@canvas/tools';

import type { TextStyleContext } from '../engine/document-text.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { createCameraSource } from './camera-source.js';
import { TextBar, type TextBarProps } from './text-bar.js';

const NOTE = 'note' as ObjectId;

const STICKY = {
  id: NOTE,
  type: 'sticky',
  parentId: null,
  x: 386,
  y: 276,
  rotation: 0,
  width: 180,
  height: 116,
  color: [...(NOTE_COLORS[2]?.color ?? [1, 1, 1, 1])],
} as unknown as BoardObject;

const EDITING: TextStyleContext = {
  style: { fontSize: 14, weight: 700, italic: false },
  align: 'left',
  isEditing: true,
  edited: { id: NOTE, type: 'sticky' },
};

/**
 * An engine whose board holds the note.
 *
 * @returns The engine, as the bar reads it.
 */
function engineWithNote(): MountedEngine {
  return {
    board: {
      board: { get: (id: ObjectId) => (id === NOTE ? STICKY : undefined) },
      state: () => ({ documentVersion: 0, selectedIds: [], enteredGroupId: null }),
      subscribe: () => () => undefined,
    },
  } as unknown as MountedEngine;
}

function renderBar(props: Partial<TextBarProps> = {}) {
  const camera = createCameraSource();
  camera.write({ x: 0, y: 0, zoom: 1, viewportWidthPx: 1440, viewportHeightPx: 900, dpr: 1 });
  const onChange = vi.fn();
  const dispatch = vi.fn();
  const textarea = document.createElement('textarea');
  textarea.dataset.textInput = '';
  document.body.append(textarea);
  const view = render(
    <TextBar
      engine={engineWithNote()}
      camera={camera}
      context={EDITING}
      canEdit
      onChange={onChange}
      dispatch={dispatch}
      {...props}
    />,
  );
  return { ...view, camera, onChange, dispatch, textarea };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('TextBar', () => {
  it('shows over the note being edited, centred, with "Esc to finish"', () => {
    const { container } = renderBar();
    const toolbar = screen.getByRole('toolbar', { name: 'Text' });
    expect(toolbar.getAttribute('aria-keyshortcuts')).toBe('Alt+F10');
    const anchor = toolbar.parentElement;
    expect(anchor?.style.left).toBe('476px');
    expect(anchor?.style.top).toBe('264px');
    expect(container.textContent).toContain('to finish');
  });

  it('shows nothing while no text is edited, for a viewer, or for an object gone', () => {
    renderBar({ context: undefined });
    expect(screen.queryByRole('toolbar')).toBeNull();
    cleanup();
    renderBar({ context: { ...EDITING, isEditing: false } });
    expect(screen.queryByRole('toolbar')).toBeNull();
    cleanup();
    renderBar({ canEdit: false });
    expect(screen.queryByRole('toolbar')).toBeNull();
    cleanup();
    renderBar({ context: { ...EDITING, edited: { id: 'gone' as ObjectId, type: 'sticky' } } });
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('sets the size, toggles bold and italic, showing which are on', () => {
    const { onChange } = renderBar();
    const size = screen.getByRole('combobox', { name: 'Text size' });
    expect((size as HTMLSelectElement).value).toBe('14');
    fireEvent.change(size, { target: { value: '24' } });
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'style', patch: { fontSize: 24 } });
    const bold = screen.getByRole('button', { name: 'Bold' });
    const italic = screen.getByRole('button', { name: 'Italic' });
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    expect(italic.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(bold);
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'toggleBold' });
    fireEvent.click(italic);
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'toggleItalic' });
  });

  it('gives the keyboard back to the text after a pointer size choice, not a keyboard one', () => {
    const { onChange, textarea } = renderBar();
    const size = screen.getByRole('combobox', { name: 'Text size' });
    size.focus();
    fireEvent.change(size, { target: { value: '24' } });
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'style', patch: { fontSize: 24 } });
    expect(document.activeElement).toBe(size);
    fireEvent.pointerDown(size);
    fireEvent.change(size, { target: { value: '18' } });
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'style', patch: { fontSize: 18 } });
    expect(document.activeElement).toBe(textarea);
    size.focus();
    fireEvent.change(size, { target: { value: '24' } });
    expect(document.activeElement).toBe(size);
  });

  it('shows link as not available yet, doing nothing', () => {
    const { onChange, dispatch } = renderBar();
    const name = 'Link — not available yet';
    const button = screen.getByRole('button', { name });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('title')).toBe(name);
    fireEvent.click(button);
    expect(onChange).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('toggles underline and strikethrough, keeping the editor’s focus', () => {
    const { onChange } = renderBar();
    for (const [name, kind] of [
      ['Underline', 'toggleUnderline'],
      ['Strikethrough', 'toggleStrikethrough'],
    ] as const) {
      const button = screen.getByRole('button', { name });
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(fireEvent.mouseDown(button)).toBe(false);
      fireEvent.click(button);
      expect(onChange).toHaveBeenLastCalledWith({ kind });
    }
  });

  it('sets a list and its level from the list menu', () => {
    const { onChange } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    const menu = screen.getByRole('menu', { name: 'List' });
    expect(menu).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bulleted list/ }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'list', list: 'bullet' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    const indent = screen.getByRole('menuitem', { name: /Indent/ });
    // Indent only takes a list; this text is plain.
    expect(indent.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(indent);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('recolours the note being edited, its colour pressed, and keeps the editor’s focus', () => {
    const { dispatch } = renderBar();
    const colours = screen.getByRole('group', { name: 'Note colour' });
    const pressed = [...colours.querySelectorAll('[aria-pressed="true"]')];
    expect(pressed.map((swatch) => swatch.getAttribute('aria-label'))).toEqual([
      NOTE_COLORS[2]?.name,
    ]);
    const first = NOTE_COLORS[0];
    const swatch = screen.getByRole('button', { name: first?.name ?? '' });
    expect(fireEvent.mouseDown(swatch)).toBe(false);
    fireEvent.click(swatch);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'style',
      changes: [{ id: NOTE, style: { color: [...(first?.color ?? [])] } }],
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'setToolStyle',
      tool: 'sticky',
      style: { color: [...(first?.color ?? [])] },
    });
  });

  it('offers no note colours for a text object', () => {
    renderBar({ context: { ...EDITING, edited: { id: NOTE, type: 'text' } } });
    expect(screen.queryByRole('group', { name: 'Note colour' })).toBeNull();
  });

  it('takes the keyboard on Alt+F10, moves with the arrows, and gives it back on Escape', () => {
    const { textarea } = renderBar();
    textarea.focus();
    const shortcut = new KeyboardEvent('keydown', {
      key: 'F10',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      textarea.dispatchEvent(shortcut);
    });
    expect(shortcut.defaultPrevented).toBe(true);
    const size = screen.getByRole('combobox', { name: 'Text size' });
    expect(document.activeElement).toBe(size);
    const bold = screen.getByRole('button', { name: 'Bold' });
    bold.focus();
    fireEvent.keyDown(bold, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Italic' }));
    fireEvent.keyDown(document.activeElement ?? bold, { key: 'End' });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Link — not available yet' }),
    );
    fireEvent.keyDown(document.activeElement ?? bold, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(size);
    const windowKeys = vi.fn();
    window.addEventListener('keydown', windowKeys);
    fireEvent.keyDown(size, { key: 'v' });
    fireEvent.keyDown(size, { key: 'Escape' });
    window.removeEventListener('keydown', windowKeys);
    expect(windowKeys).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(textarea);
  });

  it('follows the camera while it shows', () => {
    const { camera } = renderBar();
    act(() => {
      camera.write({ x: 100, y: 0, zoom: 1, viewportWidthPx: 1440, viewportHeightPx: 900, dpr: 1 });
    });
    expect(screen.getByRole('toolbar').parentElement?.style.left).toBe('376px');
  });
});
