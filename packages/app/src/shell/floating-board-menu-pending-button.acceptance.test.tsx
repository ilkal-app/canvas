// CONTRACT: keeps pending menu rows in place and inert until engine and comments arrive.
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import {
  commentContext,
  commentsPendingContext,
  type CommentMode,
} from '../comments/comment-context.js';
import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import type { BoardExporter } from '../export/run-export.js';

import { AppShell } from './app-shell.js';
import { FloatingBoardMenuButton } from './floating-board-menu-button.js';
import { shellBoardModeContext } from './shell-board-mode.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const READY_COMMENTS: CommentMode = {
  canWrite: true,
  isPlacing: false,
  isPanelOpen: false,
  setPlacing: vi.fn(),
  togglePanel: vi.fn(),
  isResolvedShown: false,
  toggleResolvedShown: vi.fn(),
};

const PENDING_EXPORTER: BoardExporter = {
  engine: undefined,
  images: undefined,
  title: 'Board',
  themeName: 'light',
  notify: vi.fn(),
};

function button(
  mode: CommentMode | undefined,
  exporter: BoardExporter | undefined,
  hasHost = true,
  hasInspector = false,
): ReactElement {
  return (
    <shellBoardModeContext.Provider
      value={{
        mode: 'whiteboard',
        changeMode: vi.fn(),
        drawers: { hasLayersDrawer: false, hasInspector },
      }}
    >
      <commentContext.Provider value={mode}>
        <FloatingBoardMenuButton
          barRef={createRef<HTMLDivElement>()}
          host={hasHost ? {} : undefined}
          onNavigateHome={vi.fn()}
          themePreference="system"
          onThemeChange={vi.fn()}
          dispatch={vi.fn()}
          className={undefined}
          exporter={exporter}
          help={{ docsUrl: '/help', feedbackUrl: 'mailto:feedback@example.com' }}
        />
      </commentContext.Provider>
    </shellBoardModeContext.Provider>
  );
}

function pendingComments(children: ReactElement): ReactElement {
  return <commentsPendingContext.Provider value={true}>{children}</commentsPendingContext.Provider>;
}

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
  return screen.getByRole('menu', { name: 'Board menu' });
}

function rows(menu: HTMLElement): HTMLElement[] {
  const list = menu.querySelector('[data-menu-list]');
  if (list === null) throw new Error('No menu list');
  return [...list.children] as HTMLElement[];
}

function rowNames(menu: HTMLElement): string[] {
  return rows(menu).map((row) =>
    row.getAttribute('role') === 'separator'
      ? 'separator'
      : (row.firstElementChild?.textContent ?? ''),
  );
}

describe('the floating board menu while inputs are pending', () => {
  it('distinguishes an absent exporter from one waiting for its engine, then enables Export', () => {
    const { engines, mount } = createFakeMount();
    const mounted = mount(document.createElement('canvas'), {});
    const engine = engines[0];
    if (engine === undefined) throw new Error('No fake engine');
    engine.select(['selected' as ObjectId]);
    const readyExporter = { ...PENDING_EXPORTER, engine: mounted };
    const view = render(button(undefined, undefined, false));
    let menu = openMenu();
    expect(within(menu).queryByRole('menuitem', { name: /^Export/ })).toBeNull();
    view.rerender(button(undefined, PENDING_EXPORTER, false));
    menu = screen.getByRole('menu', { name: 'Board menu' });
    const pending = within(menu).getByRole('menuitem', { name: /^Export/ });
    expect(pending.getAttribute('aria-disabled')).toBe('true');
    expect(pending.getAttribute('aria-haspopup')).toBeNull();
    view.rerender(button(undefined, readyExporter, false));
    const ready = within(screen.getByRole('menu', { name: 'Board menu' })).getByRole('menuitem', {
      name: /^Export/,
    });
    expect(ready.getAttribute('aria-disabled')).toBeNull();
    expect(ready.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('reserves comments only while the provider reports pending and there is no inspector', () => {
    const view = render(pendingComments(button(undefined, undefined)));
    let menu = openMenu();
    expect(
      within(menu)
        .getByRole('menuitemcheckbox', { name: 'Show resolved comments' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    view.rerender(button(undefined, undefined));
    menu = openMenu();
    expect(
      within(menu).queryByRole('menuitemcheckbox', { name: 'Show resolved comments' }),
    ).toBeNull();
    view.rerender(pendingComments(button(undefined, undefined, true, true)));
    menu = openMenu();
    expect(
      within(menu).queryByRole('menuitemcheckbox', { name: 'Show resolved comments' }),
    ).toBeNull();
    view.rerender(button(READY_COMMENTS, undefined));
    menu = openMenu();
    expect(
      within(menu)
        .getByRole('menuitemcheckbox', { name: 'Show resolved comments' })
        .getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('keeps both pending rows inert by click and Enter, then preserves open-menu row indices', () => {
    const { engines, mount } = createFakeMount();
    const mounted = mount(document.createElement('canvas'), {});
    const engine = engines[0];
    if (engine === undefined) throw new Error('No fake engine');
    engine.select(['selected' as ObjectId]);
    const view = render(pendingComments(button(undefined, PENDING_EXPORTER)));
    const menu = openMenu();
    const exportRow = within(menu).getByRole('menuitem', { name: /^Export/ });
    const commentRow = within(menu).getByRole('menuitemcheckbox', {
      name: 'Show resolved comments',
    });
    fireEvent.keyDown(within(menu).getByRole('menuitem', { name: 'All boards' }), {
      key: 'ArrowDown',
    });
    expect(document.activeElement).toBe(exportRow);
    fireEvent.keyDown(exportRow, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(commentRow);
    for (const row of [exportRow, commentRow]) {
      expect(row.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(row);
      row.focus();
      fireEvent.keyDown(row, { key: 'Enter' });
      expect(screen.getByRole('menu', { name: 'Board menu' })).toBe(menu);
    }
    expect(commentRow.getAttribute('aria-checked')).toBe('false');
    const before = rowNames(menu);
    const beforeRows = rows(menu);
    const beforeTops = rows(menu).map((row) => row.getBoundingClientRect().top);
    const helpIndex = before.findIndex((name) => name.includes('Help and feedback'));
    expect(helpIndex).toBeGreaterThan(0);
    view.rerender(
      pendingComments(button(READY_COMMENTS, { ...PENDING_EXPORTER, engine: mounted })),
    );
    const afterMenu = screen.getByRole('menu', { name: 'Board menu' });
    const after = rowNames(afterMenu);
    expect(after).toEqual(before);
    expect(after[helpIndex]).toContain('Help and feedback');
    expect(rows(afterMenu)[helpIndex]).toBe(beforeRows[helpIndex]);
    // jsdom has zero layout rects; index and DOM identity are the meaningful stability checks.
    if (beforeTops.some((top) => top !== 0)) {
      expect(rows(afterMenu).map((row) => row.getBoundingClientRect().top)).toEqual(beforeTops);
    }
    expect(
      within(afterMenu)
        .getByRole('menuitem', { name: /^Export/ })
        .getAttribute('aria-disabled'),
    ).toBeNull();
    expect(
      within(afterMenu)
        .getByRole('menuitemcheckbox', { name: 'Show resolved comments' })
        .getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('shows pending comments with a site board connection before comment mode is available', () => {
    render(
      pendingComments(
        <AppShell
          platform="mac"
          mountEngine={createFakeMount().mount}
          connection={new FakeBoardConnection('demo')}
          boardBar={{ homeHref: '/', onNavigateHome: vi.fn(), floatingMenu: {} }}
        />,
      ),
    );
    const menu = openMenu();
    expect(
      within(menu)
        .getByRole('menuitemcheckbox', { name: 'Show resolved comments' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });
});
