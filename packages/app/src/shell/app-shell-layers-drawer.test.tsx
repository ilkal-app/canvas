// @vitest-environment jsdom
// A design board, whose chrome is classic (D1).
// The shell's layers drawer: closed at first, opened and closed by the zoom control's
// toggle, its close button and alt+1, focus moving in and back, the person's choice kept for the
// next visit, the skeleton while the board loads, and no layers left in the right-hand drawer column. In Chrome:
// tooling/scenario/specs/app/layers-drawer.spec.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import { createDemoDocument } from '../engine/demo-document.js';
import { LAYERS_DRAWER_STORAGE_KEY } from '../state/layers-drawer-preference.js';

import { AppShell } from './app-shell.js';

beforeEach(() => {
  localStorage.removeItem(LAYERS_DRAWER_STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(LAYERS_DRAWER_STORAGE_KEY);
});

function renderShell(props: { readonly isLoading?: boolean } = {}) {
  const { mount } = createFakeMount(undefined, createDemoDocument());
  const view = render(<AppShell mode="diagram" platform="mac" mountEngine={mount} {...props} />);
  return { view };
}

const toggle = () => screen.getByRole('button', { name: 'Layers' });
const drawer = () => screen.queryByRole('complementary', { name: 'Layers' });

/**
 * Presses Option+1 as a Mac sends it: the key types ¡.
 *
 * @param target - Where the key goes; the focused element if absent.
 */
function pressOption1(target: Element = document.activeElement ?? document.body): void {
  act(() => {
    fireEvent.keyDown(target, { key: '¡', code: 'Digit1', altKey: true });
  });
}

async function nextFrames(): Promise<void> {
  for (let frame = 0; frame < 3; frame += 1) {
    await act(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        }),
    );
  }
}

describe('AppShell’s layers drawer', () => {
  it('starts closed, the toggle at the end of the zoom control not pressed', () => {
    renderShell();
    expect(drawer()).toBeNull();
    const zoom = screen.getByRole('group', { name: 'Zoom' });
    expect(within(zoom).getByRole('button', { name: 'Layers' })).toBe(toggle());
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('opens with the toggle and closes with its close button, the toggle pressed between', () => {
    renderShell();
    fireEvent.click(toggle());
    expect(drawer()).not.toBeNull();
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Close layers' }));
    expect(drawer()).toBeNull();
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('opens with Option+1, focus moving to the list, and closes with it, focus going back', async () => {
    renderShell();
    const canvas = screen.getByRole('main', { name: 'Canvas' });
    canvas.tabIndex = -1;
    canvas.focus();
    pressOption1();
    expect(drawer()).not.toBeNull();
    await nextFrames();
    expect(document.activeElement?.getAttribute('role')).toBe('treeitem');
    expect(document.activeElement?.textContent).toBe('Section 4');
    pressOption1();
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(canvas);
  });

  it('keeps the person’s choice for the next visit', () => {
    const first = renderShell();
    fireEvent.click(toggle());
    expect(localStorage.getItem(LAYERS_DRAWER_STORAGE_KEY)).toBe('open');
    first.view.unmount();
    renderShell();
    expect(drawer()).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(toggle());
    expect(localStorage.getItem(LAYERS_DRAWER_STORAGE_KEY)).toBe('closed');
  });

  it('lists nothing in the right-hand drawer column: the layers are in the layers drawer alone', () => {
    renderShell();
    fireEvent.click(toggle());
    expect(screen.getAllByRole('tree', { name: 'Layers' })).toHaveLength(1);
    // The column the inspector, comments and history share, the inspector open in it.
    // Opened by alt+8: no toggle shows while it is closed (item 11).
    fireEvent.keyDown(document.body, { key: '8', code: 'Digit8', altKey: true });
    const column = document.querySelector('[data-inspector]')?.parentElement;
    expect(column?.querySelector('[data-drawer="inspector"]')).not.toBeNull();
    expect(column?.querySelector('[role="tree"]')).toBeNull();
    expect(drawer()?.closest('[data-drawer="layers"]')).not.toBeNull();
  });

  it('shows skeleton rows while the board loads, then the board’s rows', () => {
    localStorage.setItem(LAYERS_DRAWER_STORAGE_KEY, 'open');
    const { mount } = createFakeMount(undefined, createDemoDocument());
    const view = render(<AppShell mode="diagram" platform="mac" mountEngine={mount} isLoading />);
    expect(screen.getByRole('tree', { name: 'Layers' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.queryAllByRole('treeitem')).toEqual([]);
    expect(document.querySelector('[data-layers-skeleton]')).not.toBeNull();
    view.rerender(<AppShell mode="diagram" platform="mac" mountEngine={mount} isLoading={false} />);
    expect(document.querySelector('[data-layers-skeleton]')).toBeNull();
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0);
  });
});
