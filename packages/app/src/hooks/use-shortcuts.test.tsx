// @vitest-environment jsdom
// Real key events (layouts, auto-repeat, IME composition, shadow DOM targets) in a browser:
// tooling/scenario/specs/app (shortcuts, keyboard-layouts, editable-guard).
import { cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createShortcutRegistry,
  registerShortcut,
  type ShortcutRegistry,
} from '../shortcuts/shortcut-registry.js';

import { useShortcuts } from './use-shortcuts.js';

function testRegistry(): ShortcutRegistry<string> {
  let registry = createShortcutRegistry<string>('other');
  registry = registerShortcut(registry, {
    id: 'tools.pen',
    chords: ['p'],
    description: 'Pen',
    category: 'tools',
    action: 'pen',
  });
  registry = registerShortcut(registry, {
    id: 'selection.nudge-up',
    chords: ['arrowup'],
    description: 'Nudge up',
    category: 'selection',
    action: 'nudge',
    canRepeat: true,
  });
  registry = registerShortcut(registry, {
    id: 'selection.activate',
    chords: ['enter'],
    description: 'Edit the selected object',
    category: 'selection',
    action: 'activate',
  });
  registry = registerShortcut(registry, {
    id: 'navigation.hand',
    chords: ['space'],
    description: 'Hand',
    category: 'navigation',
    action: 'hand',
  });
  return registerShortcut(registry, {
    id: 'selection.copy',
    chords: ['mod+c'],
    description: 'Copy',
    category: 'selection',
    action: 'copy',
    isNative: true,
  });
}

function mountShortcuts(isEnabled = true) {
  const dispatch = vi.fn<(action: string) => void>();
  const hook = renderHook(() => {
    useShortcuts(testRegistry(), dispatch, isEnabled);
  });
  return { dispatch, hook };
}

function appendToBody<T extends HTMLElement>(child: T): T {
  document.body.append(child);
  return child;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('useShortcuts', () => {
  it('dispatches the action of a pressed shortcut and prevents the browser default', () => {
    const { dispatch } = mountShortcuts();
    const isNotCancelled = fireEvent.keyDown(document.body, { key: 'p', code: 'KeyP' });
    expect(dispatch).toHaveBeenCalledWith('pen');
    expect(isNotCancelled).toBe(false);
  });

  it('ignores keys that press no shortcut and leaves their default alone', () => {
    const { dispatch } = mountShortcuts();
    const isNotCancelled = fireEvent.keyDown(document.body, { key: 'q', code: 'KeyQ' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(isNotCancelled).toBe(true);
  });

  it('leaves native shortcuts to the browser', () => {
    const { dispatch } = mountShortcuts();
    const isNotCancelled = fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });
    expect(dispatch).not.toHaveBeenCalled();
    expect(isNotCancelled).toBe(true);
  });

  it.each([
    { place: 'a text field', create: () => document.createElement('input') },
    { place: 'a text area', create: () => document.createElement('textarea') },
    { place: 'a select', create: () => document.createElement('select') },
    {
      place: 'a contenteditable region',
      create: () => {
        const region = document.createElement('div');
        region.setAttribute('contenteditable', 'true');
        return region;
      },
    },
  ])('ignores keys typed into $place', ({ create }) => {
    const { dispatch } = mountShortcuts();
    const field = appendToBody(create());
    const isNotCancelled = fireEvent.keyDown(field, { key: 'p', code: 'KeyP' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(isNotCancelled).toBe(true);
  });

  it('still handles keys pressed while a button has focus', () => {
    const { dispatch } = mountShortcuts();
    const button = appendToBody(document.createElement('button'));
    fireEvent.keyDown(button, { key: 'p', code: 'KeyP' });
    expect(dispatch).toHaveBeenCalledWith('pen');
  });

  it.each([
    { name: 'a toolbar button', html: '<button type="button">Pen</button>' },
    { name: 'a link', html: '<a href="#help">Help</a>' },
    { name: 'a disclosure summary', html: '<details><summary>More</summary></details>' },
    { name: 'a menu item', html: '<div role="menuitem" tabindex="-1">Copy</div>' },
    { name: 'a switch', html: '<div role="switch" tabindex="0" aria-checked="false"></div>' },
    { name: 'a tab', html: '<div role="tab" tabindex="0">Style</div>' },
    { name: 'an option', html: '<div role="option" tabindex="-1">Lora</div>' },
    { name: 'a checkbox role', html: '<div role="checkbox" tabindex="0"></div>' },
    { name: 'a radio role', html: '<div role="radio" tabindex="0"><b>One</b></div>' },
    { name: 'a link role', html: '<span role="link" tabindex="0"><b>Help</b></span>' },
    { name: 'a combobox role', html: '<div role="combobox" tabindex="0"><b>Font</b></div>' },
    { name: 'a tree item', html: '<div role="treeitem" tabindex="0">Layer</div>' },
    { name: 'a role button', html: '<span role="button" tabindex="0"><b>Zoom</b></span>' },
  ])('leaves Enter and Space to $name, which they press', ({ html }) => {
    const { dispatch } = mountShortcuts();
    const host = appendToBody(document.createElement('div'));
    host.innerHTML = html;
    const control =
      host.querySelector('b') ?? host.querySelector('summary') ?? host.firstElementChild;
    if (control === null) throw new Error(`No control in ${html}`);
    for (const key of ['Enter', ' ']) {
      const isNotCancelled = fireEvent.keyDown(control, { key });
      expect(isNotCancelled).toBe(true);
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('runs the Enter and Space shortcuts with focus on the canvas or the page', () => {
    const { dispatch } = mountShortcuts();
    const canvas = appendToBody(document.createElement('canvas'));
    expect(fireEvent.keyDown(canvas, { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyDown(document.body, { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyDown(document.body, { key: ' ' })).toBe(false);
    expect(dispatch.mock.calls).toEqual([['activate'], ['activate'], ['hand']]);
  });

  it('leaves Enter and Space to a button inside shadow DOM, whose host is the target', () => {
    const { dispatch } = mountShortcuts();
    const host = appendToBody(document.createElement('div'));
    const button = document.createElement('button');
    host.attachShadow({ mode: 'open' }).append(button);
    button.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('ignores a key a component already handled', () => {
    const { dispatch } = mountShortcuts();
    const button = appendToBody(document.createElement('button'));
    button.addEventListener('keydown', (event) => {
      event.preventDefault();
    });
    fireEvent.keyDown(button, { key: 'p', code: 'KeyP' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('ignores keys during IME composition', () => {
    const { dispatch } = mountShortcuts();
    fireEvent.keyDown(document.body, { key: 'p', code: 'KeyP', isComposing: true });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('ignores auto-repeat unless the shortcut can repeat', () => {
    const { dispatch } = mountShortcuts();
    fireEvent.keyDown(document.body, { key: 'p', code: 'KeyP', repeat: true });
    fireEvent.keyDown(document.body, { key: 'ArrowUp', code: 'ArrowUp', repeat: true });
    expect(dispatch.mock.calls).toEqual([['nudge']]);
  });

  it('does nothing while disabled', () => {
    const { dispatch } = mountShortcuts(false);
    fireEvent.keyDown(document.body, { key: 'p', code: 'KeyP' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('stops listening when unmounted', () => {
    const { dispatch, hook } = mountShortcuts();
    hook.unmount();
    fireEvent.keyDown(document.body, { key: 'p', code: 'KeyP' });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
