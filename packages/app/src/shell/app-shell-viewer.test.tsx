// @vitest-environment jsdom
// A design board, whose chrome is classic (D1).
// The shell of a person who cannot edit the board (a viewer or a commenter), and of an
// editor whose role changes while the board is open. In Chrome, with the boards service and the
// relay: tooling/scenario/specs/site/viewer.spec.ts and access.spec.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { MemoryDocumentCache } from '@canvas/collab';

import type { BoardConnectionStatus } from '../collab/board-connection-status.js';
import type { BoardConnection } from '../collab/board-connection.js';
import { createLocalBoardConnection } from '../collab/local-board-connection.js';
import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';

import { openLayersDrawer } from './__fixtures__/layers-drawer-steps.js';
import { AppShell } from './app-shell.js';
import { preloadWorkspaceParts } from './lazy-workspace-parts.js';

/** A connection to a board whose read-only flag the test sets, as the relay would answer. */
interface ControlledConnection {
  readonly connection: BoardConnection;
  /** Gives the person's new role: read-only (a viewer) or not (an editor). */
  readonly setReadOnly: (isReadOnly: boolean) => void;
}

/**
 * A synced-looking connection over a local board, read-only or not as the test says.
 *
 * @param boardId - The board; each test its own, as the notice is remembered per board.
 * @param isReadOnly - Whether the person starts as a viewer.
 * @returns The connection and its control.
 */
async function connect(boardId: string, isReadOnly: boolean): Promise<ControlledConnection> {
  const local = await createLocalBoardConnection(boardId, {
    openCache: () => Promise.resolve(new MemoryDocumentCache()),
  });
  const listeners = new Set<() => void>();
  let status: BoardConnectionStatus = {
    ...local.status(),
    state: 'connected',
    isLocalOnly: false,
    isReadOnly,
  };
  const connection: BoardConnection = {
    store: local.store,
    origin: local.origin,
    status: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dismissStrandedEdits: () => undefined,
    destroy: () => {
      local.destroy();
    },
  };
  const setReadOnly = (isNowReadOnly: boolean) => {
    act(() => {
      status = { ...status, isReadOnly: isNowReadOnly };
      for (const listener of listeners) listener();
    });
  };
  return { connection, setReadOnly };
}

/**
 * Renders the shell on a connection with a fake engine.
 *
 * @param connection - The board's connection.
 * @returns The fake engines mounted.
 */
function renderShell(connection: BoardConnection) {
  const { mount, engines } = createFakeMount();
  const view = render(
    <AppShell mode="diagram" platform="mac" mountEngine={mount} connection={connection} />,
  );
  return { engines, view };
}

/**
 * The names of the toolbar's tool buttons.
 *
 * @returns The names.
 */
function toolNames(): string[] {
  const tools = screen.getByRole('toolbar', { name: 'Tools' });
  return within(tools)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent);
}

/**
 * The view-only notice's message, if it shows.
 *
 * @returns The paragraph, or null.
 */
function viewOnlyMessage(): HTMLElement | null {
  // Item 4: a toast in the one region, there only while it shows (rewritten from the
  // region that stayed mounted, empty; the callers' assertions are unchanged).
  const region = screen.queryByRole('status', { name: 'Board access' });
  return region === null ? null : within(region).queryByText('You can view this board');
}

/**
 * What the engine was told, each value once in a row (the mount and its effect may repeat it).
 *
 * @param told - Every `setEditable` argument, in order.
 * @returns The changes.
 */
function changesOf(told: readonly boolean[] | undefined): boolean[] {
  return (told ?? []).filter(
    (isEditable, index, all) => index === 0 || all[index - 1] !== isEditable,
  );
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  document.body.innerHTML = '';
});

// The style panel and the selection popover load apart from the first script.
beforeAll(preloadWorkspaceParts);

describe('AppShell for a person who cannot edit', () => {
  it('shows the select tool alone, no style panel and no lock toggles, and tells the engine', async () => {
    const { connection } = await connect('viewer-board-a', true);
    const { engines } = renderShell(connection);
    // The select tool and the hand, which only pans: no creation tool, no switcher.
    expect(toolNames()).toHaveLength(2);
    expect(toolNames()[0]).toMatch(/Select/);
    expect(toolNames()[1]).toMatch(/^Hand/);
    expect(screen.queryByRole('complementary', { name: 'Style' })).toBeNull();
    // The layers drawer, closed at first, opens for a viewer too.
    openLayersDrawer();
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: /^(Lock|Unlock) / })).toEqual([]);
    expect(changesOf(engines[0]?.editable)).toEqual([false]);
    connection.destroy();
  });

  it('runs no editing shortcut, and keeps navigation, selection and copy', async () => {
    const { connection } = await connect('viewer-board-b', true);
    const { engines } = renderShell(connection);
    const engine = engines[0];
    for (const key of ['p', 's', 'Delete', 'Backspace']) fireEvent.keyDown(document.body, { key });
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'd', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'g', metaKey: true });
    fireEvent.keyDown(document.body, { key: '=' });
    fireEvent.keyDown(document.body, { key: 'a', metaKey: true });
    expect(engine?.actions).toEqual([
      { type: 'navigate', command: 'zoomIn' },
      { type: 'selection', command: 'selectAll' },
    ]);
    expect(engine?.activeTools.every((tool) => tool === 'select')).toBe(true);
    connection.destroy();
  });

  it('says “You can view this board” once per board per session, until dismissed', async () => {
    const { connection } = await connect('viewer-board-c', true);
    const first = renderShell(connection);
    expect(viewOnlyMessage()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: You can view this board' }));
    expect(viewOnlyMessage()).toBeNull();
    first.view.unmount();
    // Opened again in the same session (a reload): it does not say it again.
    renderShell(connection);
    expect(viewOnlyMessage()).toBeNull();
    connection.destroy();
  });

  it('says nothing to an editor', async () => {
    const { connection } = await connect('editor-board-d', false);
    const { engines } = renderShell(connection);
    expect(viewOnlyMessage()).toBeNull();
    expect(toolNames().length).toBeGreaterThan(1);
    // With nothing selected the inspector drawer is closed: alt+8 opens it.
    fireEvent.keyDown(document.body, { key: '8', code: 'Digit8', altKey: true });
    expect(screen.getByRole('complementary', { name: 'Style' })).toBeInstanceOf(HTMLElement);
    openLayersDrawer();
    expect(screen.queryAllByRole('button', { name: /^(Lock|Unlock) / }).length).toBeGreaterThan(0);
    expect(changesOf(engines[0]?.editable)).toEqual([true]);
    connection.destroy();
  });

  it('follows a role changed while the board is open, without a remount', async () => {
    const { connection, setReadOnly } = await connect('changing-board-e', true);
    const { engines } = renderShell(connection);
    const engine = engines[0];
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: You can view this board' }));
    // Made an editor: the tools, the style panel and the shortcuts come back, the notice stays away.
    setReadOnly(false);
    expect(toolNames().length).toBeGreaterThan(1);
    // With nothing selected the inspector drawer is closed: alt+8 opens it.
    fireEvent.keyDown(document.body, { key: '8', code: 'Digit8', altKey: true });
    expect(screen.getByRole('complementary', { name: 'Style' })).toBeInstanceOf(HTMLElement);
    expect(viewOnlyMessage()).toBeNull();
    fireEvent.keyDown(document.body, { key: 's' });
    expect(engine?.activeTools.at(-1)).toBe('sticky');
    // Made a viewer again: the sticky tool goes, and the notice says so again.
    setReadOnly(true);
    expect(toolNames()).toHaveLength(2);
    expect(engine?.activeTools.at(-1)).toBe('select');
    expect(viewOnlyMessage()).not.toBeNull();
    expect(changesOf(engine?.editable)).toEqual([false, true, false]);
    expect(engines).toHaveLength(1);
    connection.destroy();
  });
});
