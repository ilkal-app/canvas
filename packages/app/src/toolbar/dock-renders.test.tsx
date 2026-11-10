// @vitest-environment jsdom
// A design board, whose chrome is classic (D1).
// How often the dock renders in the shell: only when a slice of the shell state it
// shows changes, not on every canvas action or view preference. Its buttons are counted, since
// each render of the dock renders every one of them. Rewritten from toolbar-renders.test.tsx when
// the old toolbar went; the grid and snapping toggles are the board menu's now.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import { AppShell } from '../shell/app-shell.js';
import { DOCK_LAYOUTS } from '../state/dock-layout.js';

import type * as DockButtonModule from './dock-button.js';
import type { DockButtonProps } from './dock-button.js';

const counter = vi.hoisted(() => ({ dockButtonRenders: 0 }));

vi.mock('./dock-button.js', async (importOriginal) => {
  const actual = await importOriginal<typeof DockButtonModule>();
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- The module's export is a component, PascalCase.
    DockButton: (props: DockButtonProps) => {
      counter.dockButtonRenders += 1;
      return createElement(actual.DockButton, props);
    },
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/**
 * The dock's buttons in the standalone shell: the UI / UX dock, whose chrome is the classic one
 * (D1), without the comment button.
 */
const DOCK_BUTTONS = DOCK_LAYOUTS.uiux.filter((entry) => entry !== 'comment').length;

/**
 * Dock renders since a count of dock button renders (each renders every dock button).
 *
 * @param from - The dock button renders before.
 * @returns How many times the dock rendered since.
 */
function dockRendersSince(from: number): number {
  return (counter.dockButtonRenders - from) / DOCK_BUTTONS;
}

function pressKey(key: string, init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(document.body, { key, ...init });
}

describe('the dock in the shell', () => {
  it('does not render again for canvas actions or view preferences, only for its slices', () => {
    const { mount, engines } = createFakeMount();
    render(<AppShell mode="uiux" platform="mac" onCanvasReady={vi.fn()} mountEngine={mount} />);
    const start = counter.dockButtonRenders;
    pressKey('=', { metaKey: true });
    pressKey('-', { metaKey: true });
    pressKey('!', { shiftKey: true, code: 'Digit1' });
    pressKey('a', { metaKey: true });
    pressKey('ArrowLeft');
    pressKey('ArrowRight', { shiftKey: true });
    pressKey('z', { metaKey: true });
    pressKey('Escape');
    expect(engines[0]?.actions.length).toBeGreaterThanOrEqual(8);
    expect(dockRendersSince(start)).toBe(0);
    // The grid and snapping are view preferences: the dock does not render for them.
    pressKey("'", { metaKey: true });
    pressKey("'", { metaKey: true, shiftKey: true });
    expect(dockRendersSince(start)).toBe(0);
    // A tool is the dock's: it renders once.
    pressKey('p');
    expect(dockRendersSince(start)).toBe(1);
    const tools = screen.getByRole('toolbar', { name: 'Tools' });
    expect(within(tools).getByRole('button', { name: /^Pen/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
