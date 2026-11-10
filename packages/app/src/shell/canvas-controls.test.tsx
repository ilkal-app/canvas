// @vitest-environment jsdom
// What floats over the canvas at each width: 768 px and wider the dock and the zoom
// control as before; below 768 px the compact bottom bar, the undo pill and the compact zoom
// control, the bar dimmed while the live board loads (L1). In Chrome:
// tooling/scenario/specs/app/mobile-bar.spec.ts.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardConnectionStatus } from '../collab/board-connection-status.js';
import type { ConnectionStatusSource } from '../collab/board-connection.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';
import dockStyles from '../toolbar/dock.module.css';
import { createZoomSource } from '../toolbar/zoom-source.js';

import { fakeViewport } from './__fixtures__/fake-media.js';
import { CanvasControls, EDITING_STARTS_LIVE } from './canvas-controls.js';

const CONNECTING: BoardConnectionStatus = {
  boardId: 'demo',
  state: 'connecting',
  isLocalOnly: false,
  isSavedOnDevice: true,
  pendingUpdateCount: 0,
  isAcknowledged: false,
  isReadOnly: false,
  rejectionReason: undefined,
  collaborators: [],
  strandedEdits: [],
};

/**
 * Gives the page a viewport of a width, as `window.matchMedia` answers it.
 *
 * @param width - The width, CSS px.
 */
function useViewport(width: number): void {
  Object.defineProperty(window, 'matchMedia', {
    value: fakeViewport(width).matchMedia,
    configurable: true,
    writable: true,
  });
}

/**
 * Renders the controls.
 *
 * @param connection - The board's connection, if any.
 */
function renderControls(connection?: ConnectionStatusSource): void {
  render(
    <CanvasControls
      registry={createDefaultShortcutRegistry('mac')}
      state={{ ...INITIAL_SHELL_STATE, isLayersDrawerOpen: false }}
      zoom={createZoomSource()}
      host={{ connection }}
      dispatch={vi.fn()}
    />,
  );
}

beforeEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('CanvasControls', () => {
  it('at 768 px shows the dock and the whole zoom control, as before', () => {
    useViewport(768);
    renderControls();
    const dock = screen.getByRole('toolbar', { name: 'Tools' });
    expect(dock.className).toBe(dockStyles.dock);
    expect(screen.queryByRole('group', { name: 'History' })).toBeNull();
    const zoom = screen.getByRole('group', { name: 'Zoom' });
    expect(zoom.hasAttribute('data-compact')).toBe(false);
    expect(within(zoom).getByRole('button', { name: 'Zoom in' })).toBeDefined();
  });

  it('at 767 px shows the compact bar, the undo pill and the compact zoom control', () => {
    useViewport(767);
    renderControls();
    const bar = screen.getByRole('toolbar', { name: 'Tools' });
    expect(bar.className).toBe(dockStyles.compactBar);
    expect(screen.getByRole('group', { name: 'History' })).toBeDefined();
    const zoom = screen.getByRole('group', { name: 'Zoom' });
    expect(zoom.hasAttribute('data-compact')).toBe(true);
    expect(within(zoom).queryByRole('button', { name: 'Zoom in' })).toBeNull();
    expect(within(zoom).queryByRole('button', { name: 'Zoom out' })).toBeNull();
    expect(within(zoom).getByRole('button', { name: /^Zoom to fit/ })).toBeDefined();
    expect(within(zoom).getByRole('button', { name: /^Layers/ })).toBeDefined();
  });

  it('dims the compact bar and says editing starts when the board is live while it loads (L1)', () => {
    useViewport(390);
    renderControls({ status: () => CONNECTING, subscribe: () => () => undefined });
    const bar = screen.getByRole('toolbar', { name: 'Tools', hidden: true });
    expect(bar.hasAttribute('data-dimmed')).toBe(true);
    expect(bar.getAttribute('aria-disabled')).toBe('true');
    expect(bar.firstElementChild?.hasAttribute('inert')).toBe(true);
    expect(screen.getByText(EDITING_STARTS_LIVE).getAttribute('role')).toBe('status');
    expect(EDITING_STARTS_LIVE).toBe('Editing starts when the board is live');
  });

  it('leaves the bar live once the board is', () => {
    useViewport(390);
    const live = { ...CONNECTING, state: 'connected', isAcknowledged: true } as const;
    renderControls({ status: () => live, subscribe: () => () => undefined });
    const bar = screen.getByRole('toolbar', { name: 'Tools' });
    expect(bar.hasAttribute('data-dimmed')).toBe(false);
    expect(screen.queryByText(EDITING_STARTS_LIVE)).toBeNull();
  });
});
