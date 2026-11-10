// @vitest-environment jsdom
// A design board, whose chrome is classic (D1).
// The shell's page list wired to the engine's pages and the board's connection. In
// Chrome: tooling/scenario/specs/app/pages-panel.spec.ts.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import { createSeededIdGenerator, type PrincipalId } from '@canvas/schema';

import { clipboardBoard } from '../clipboard/__fixtures__/clipboard-board.js';
import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import type { MountEngine } from '../engine/mounted-engine.js';
import type { PendingEngine } from '../engine/pending-engine.js';
import { createPageView } from '../pages/create-page-view.js';
import { LAYERS_DRAWER_STORAGE_KEY } from '../state/layers-drawer-preference.js';

import { AppShell } from './app-shell.js';
import { preloadWorkspaceParts } from './lazy-workspace-parts.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;

// The page list sits at the top of the layers drawer, open here as a person left it.
beforeEach(() => {
  localStorage.setItem(LAYERS_DRAWER_STORAGE_KEY, 'open');
});

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
  localStorage.removeItem(LAYERS_DRAWER_STORAGE_KEY);
});

/**
 * A fake engine mount whose engines carry a board's pages.
 *
 * @returns The mount, its engines, the board and its pages.
 */
function mountWithPages() {
  const store = new YjsDocumentStore();
  const environment = { clock: () => 1, createId: createSeededIdGenerator(4) };
  const { pages, release } = createPageView(store, ORIGIN, environment, {});
  const { mount, engines } = createFakeMount(undefined, store);
  const withPages: MountEngine = (canvas, options) =>
    Object.assign(mount(canvas, options), { pages });
  return { mount: withPages, engines, store, pages, release };
}

// The style panel and the selection popover load apart from the first script.
beforeAll(preloadWorkspaceParts);

describe('AppShell pages', () => {
  it('tells the connection the page shown, and says which page each collaborator is on', () => {
    const { mount, store, pages, release } = mountWithPages();
    pages.run('addPage', {});
    const connection = new FakeBoardConnection('demo');
    const showPage = vi.fn();
    Object.assign(connection, { showPage });
    vi.spyOn(connection, 'status').mockReturnValue({
      ...connection.status(),
      collaborators: [
        { principalId: 'jo', kind: 'user', name: 'Jonas', color: '#c77ddb', page: 'page-1' },
      ],
    });
    render(<AppShell mode="diagram" platform="mac" mountEngine={mount} connection={connection} />);
    expect(showPage).toHaveBeenCalledWith('page-1');
    expect(screen.getByRole('img', { name: 'Jonas, on Page 1' })).toBeDefined();
    cleanup();
    release();
    store.destroy();
  });

  it('shows the page list with no connection to tell, or one that takes no page', () => {
    const { mount, store, release } = mountWithPages();
    render(<AppShell mode="diagram" platform="mac" mountEngine={mount} />);
    expect(screen.getByRole('region', { name: 'Pages' }).textContent).toContain('Page 1');
    cleanup();
    render(
      <AppShell
        mode="diagram"
        platform="mac"
        mountEngine={mount}
        connection={new FakeBoardConnection('demo')}
      />,
    );
    expect(screen.getByRole('region', { name: 'Pages' }).textContent).toContain('Page 1');
    release();
    store.destroy();
  });
});

describe('AppShell without the board’s images', () => {
  it('knows nothing of a selected image’s asset', async () => {
    const store = new YjsDocumentStore();
    const photo = [...clipboardBoard().objects.values()].find(({ type }) => type === 'image');
    if (photo === undefined) throw new Error('the clipboard board holds an image');
    store.transact(ORIGIN, (tx) => {
      tx.setObject({ ...photo, parentId: null });
    });
    const { mount, engines } = createFakeMount(undefined, store);
    render(<AppShell mode="diagram" platform="mac" mountEngine={mount} />);
    act(() => {
      engines[0]?.select([photo.id]);
    });
    const style = screen.getByRole('complementary', { name: 'Style' });
    await vi.waitFor(() => {
      expect(style.getAttribute('data-context')).toBe('image');
    });
    store.destroy();
  });
});

describe('AppShell with a pending engine', () => {
  it('starts the engine through the host, its default mount unused, until it hands over', () => {
    const session: PendingEngine = {
      ready: new Promise(() => undefined),
      resize: vi.fn(),
      destroy: vi.fn(),
    };
    const startEngine = vi.fn(() => session);
    const view = render(<AppShell mode="diagram" platform="mac" startEngine={startEngine} />);
    expect(startEngine).toHaveBeenCalledTimes(1);
    expect(startEngine).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), expect.anything());
    view.unmount();
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });
});
