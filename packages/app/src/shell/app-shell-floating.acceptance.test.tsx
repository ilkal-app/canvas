// @vitest-environment jsdom
// The floating whiteboard shell omits mode and panel chrome while other modes and
// the default classic shell keep their controls. Browser geometry is covered by the scenario.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { commentContext, type CommentMode } from '../comments/comment-context.js';
import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import { createDemoDocument } from '../engine/demo-document.js';
import { LAYERS_DRAWER_STORAGE_KEY } from '../state/layers-drawer-preference.js';

import { AppShell, type AppShellProps } from './app-shell.js';
import { preloadWorkspaceParts } from './lazy-workspace-parts.js';
import { NOT_IN_WHITEBOARD_NOTICE } from './whiteboard-chrome.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderShell(props: Partial<AppShellProps> = {}, hasComments = false) {
  const { mount, engines } = createFakeMount(undefined, createDemoDocument());
  const comments: CommentMode = {
    isPlacing: false,
    canWrite: true,
    isPanelOpen: false,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
  };
  render(
    <commentContext.Provider value={hasComments ? comments : undefined}>
      <AppShell platform="mac" mountEngine={mount} {...props} />
    </commentContext.Provider>,
  );
  return { engine: engines[0] };
}

function pressShortcut(code: 'Digit1' | 'Digit8'): void {
  fireEvent.keyDown(document.body, {
    key: code === 'Digit1' ? '¡' : '8',
    code,
    altKey: true,
  });
}

function expectNoDrawers(): void {
  expect(document.querySelector('[data-drawer="layers"]')).toBeNull();
  expect(document.querySelector('[data-drawer="inspector"]')).toBeNull();
  expect(screen.queryByRole('complementary', { name: 'Layers' })).toBeNull();
  expect(screen.queryByRole('complementary', { name: 'Style' })).toBeNull();
}

// The style panel and the selection popover load apart from the first script.
beforeAll(preloadWorkspaceParts);

describe('floating AppShell acceptance', () => {
  it('omits both whiteboard drawers and the zoom control layers toggle', () => {
    renderShell();
    expectNoDrawers();
    expect(document.querySelector('[data-layers-toggle]')).toBeNull();
  });

  it('keeps a selected whiteboard object from opening the inspector', () => {
    const { engine } = renderShell();
    act(() => engine?.select(['section-0-rect-0-0' as ObjectId]));
    expectNoDrawers();
  });

  it('announces that whiteboard has no layers or inspector on both shortcuts', () => {
    renderShell();
    expect(NOT_IN_WHITEBOARD_NOTICE).toBe('Layers and the inspector aren’t on whiteboard boards');
    for (const code of ['Digit1', 'Digit8'] as const) {
      pressShortcut(code);
      expect(screen.getByRole('status', { name: 'Notice' }).textContent).toContain(
        NOT_IN_WHITEBOARD_NOTICE,
      );
      expectNoDrawers();
    }
  });

  it('ignores the stored open layers preference on a floating whiteboard', () => {
    localStorage.setItem(LAYERS_DRAWER_STORAGE_KEY, 'open');
    renderShell();
    expectNoDrawers();
  });

  it('hides the desktop mode switcher inside the floating shell context', () => {
    renderShell();
    expect(
      within(screen.getByRole('toolbar', { name: 'Tools' })).queryByRole('radiogroup', {
        name: 'Board mode',
      }),
    ).toBeNull();
  });

  it('removes Comments from the whiteboard menu when a comments host is present', () => {
    renderShell({}, true);
    fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
    expect(
      within(screen.getByRole('menu', { name: 'Board menu' })).queryByRole('menuitemcheckbox', {
        name: 'Comments',
      }),
    ).toBeNull();
  });

  it('keeps both drawers available in floating UI / UX mode without a switcher', () => {
    renderShell({ mode: 'uiux' });
    expect(screen.queryByRole('radiogroup', { name: 'Board mode' })).toBeNull();
    pressShortcut('Digit8');
    expect(screen.getByRole('complementary', { name: 'Style' })).toBeTruthy();
    pressShortcut('Digit1');
    expect(screen.getByRole('complementary', { name: 'Layers' })).toBeTruthy();
  });

  it('keeps the classic inspector shortcut and Comments menu entry, with no switcher', () => {
    renderShell({ mode: 'diagram' }, true);
    expect(screen.queryByRole('radiogroup', { name: 'Board mode' })).toBeNull();
    pressShortcut('Digit8');
    expect(screen.getByRole('complementary', { name: 'Style' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Comments' })).toBeTruthy();
  });
});
