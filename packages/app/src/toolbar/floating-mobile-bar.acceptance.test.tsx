// @vitest-environment jsdom
// CONTRACT: floating chrome keeps its dock, panels and reactions at mobile width.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commentContext } from '../comments/comment-context.js';
import { createFloatingShortcutRegistry } from '../keymap/floating-keymap.js';
import { boardReactions } from '../reactions/__fixtures__/board-reactions.js';
import { reactionsContext, type BoardReactions } from '../reactions/reactions-context.js';
import { fakeViewport } from '../shell/__fixtures__/fake-media.js';
import { CanvasControls } from '../shell/canvas-controls.js';
import { whiteboardChromeContext } from '../shell/whiteboard-chrome.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';

import { writer } from './__fixtures__/render-dock.js';
import { FloatingDock } from './floating-dock.js';
import { createZoomSource } from './zoom-source.js';

const registry = createFloatingShortcutRegistry('mac');

/** Makes the mobile media query match, as the shell's responsive hook reads it. */
function usePhoneViewport(): void {
  Object.defineProperty(window, 'matchMedia', {
    value: fakeViewport(390).matchMedia,
    configurable: true,
    writable: true,
  });
}

/**
 * Renders the editor dock with comments and the optional reactions flow.
 *
 * @param options - The active mode and reactions flow.
 * @param options.activeTool - The active mode, or Image's modeless panel.
 * @param options.reactions - The reactions flow.
 * @returns Its dispatch spy and toolbar.
 */
function renderDock(
  options: {
    activeTool?: typeof INITIAL_SHELL_STATE.activeTool;
    reactions?: BoardReactions;
  } = {},
) {
  const dispatch = vi.fn();
  render(
    <commentContext.Provider value={writer()}>
      <reactionsContext.Provider value={options.reactions}>
        <FloatingDock
          registry={registry}
          state={{
            ...INITIAL_SHELL_STATE,
            activeTool:
              options.activeTool === 'image' ? 'select' : (options.activeTool ?? 'select'),
            ...(options.activeTool === 'image'
              ? { toolPanelRequest: { panel: 'image' as const, sequence: 1 } }
              : {}),
          }}
          dispatch={dispatch}
        />
      </reactionsContext.Provider>
    </commentContext.Provider>,
  );
  return { dispatch, bar: screen.getByRole('toolbar', { name: 'Tools' }) };
}

beforeEach(usePhoneViewport);
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('compact floating dock', () => {
  it('replaces the classic mobile bar in the floating whiteboard shell and keeps Undo', () => {
    render(
      <whiteboardChromeContext.Provider value="floating">
        <CanvasControls
          registry={registry}
          state={INITIAL_SHELL_STATE}
          zoom={createZoomSource()}
          host={{}}
          dispatch={vi.fn()}
        />
      </whiteboardChromeContext.Provider>,
    );
    const bar = screen.getByRole('toolbar', { name: 'Tools' });
    expect(bar.hasAttribute('data-floating-dock')).toBe(true);
    expect(bar.hasAttribute('data-compact')).toBe(true);
    expect(screen.getByRole('group', { name: 'History' })).toBeTruthy();
    expect(within(bar).queryByRole('button', { name: /^Pan/ })).toBeNull();
  });

  it('shows the three compact groups and the editor’s accessible More menu', () => {
    const { bar } = renderDock();
    expect(bar.hasAttribute('data-compact')).toBe(true);
    expect(
      within(bar)
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-label')),
    ).toEqual(['Navigate', 'Set the stage', 'Collaborate']);
    expect(
      within(bar)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Select (V)',
      'Shapes (S)',
      'Text (T)',
      'Draw (P)',
      'Sticky note (N)',
      'Comment (M)',
      'More tools',
    ]);
    const more = within(bar).getByRole('button', { name: 'More tools' });
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'More tools' });
    const items = within(menu).getAllByRole('menuitemradio');
    for (const [index, name] of ['Section', 'Image', 'Connector', 'Reactions'].entries()) {
      expect(items[index]).toBe(within(menu).getByRole('menuitemradio', { name }));
    }
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'More tools' })).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('chooses a More tool with the same action as its dock button and restores focus', () => {
    const { dispatch, bar } = renderDock();
    const more = within(bar).getByRole('button', { name: 'More tools' });
    fireEvent.click(more);
    const connector = within(screen.getByRole('menu', { name: 'More tools' })).getByRole(
      'menuitemradio',
      { name: 'Connector' },
    );
    expect(connector.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(connector);
    expect(dispatch).toHaveBeenCalledWith({ type: 'selectTool', tool: 'connector' });
    expect(screen.queryByRole('menu', { name: 'More tools' })).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it.each([
    ['commenter', ['Select (V)', 'Comment (M)', 'Reactions (E)']],
    ['viewer', ['Select (V)']],
  ] as const)('keeps the %s tools in sections without More', (role, names) => {
    render(
      <commentContext.Provider value={role === 'commenter' ? writer() : undefined}>
        <FloatingDock
          registry={registry}
          state={{ ...INITIAL_SHELL_STATE, canEdit: false }}
          dispatch={vi.fn()}
        />
      </commentContext.Provider>,
    );
    const bar = screen.getByRole('toolbar', { name: 'Tools' });
    expect(bar.hasAttribute('data-compact')).toBe(true);
    expect(
      within(bar)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(names);
    expect(within(bar).queryByRole('button', { name: 'More tools' })).toBeNull();
  });

  it.each(['shape', 'draw', 'sticky', 'connector', 'image'] as const)(
    'opens the %s tool panel as a bottom sheet',
    (activeTool) => {
      const { bar } = renderDock({ activeTool });
      expect(bar.hasAttribute('data-compact')).toBe(true);
      const panel = document.querySelector('[data-tool-panel]');
      expect(panel).not.toBeNull();
      expect(panel?.hasAttribute('data-sheet')).toBe(true);
    },
  );

  it('shows Reactions pressed in More and renders its flyout as a sheet', () => {
    const reactions = boardReactions({ isOpen: true });
    const { bar } = renderDock({ reactions });
    const more = within(bar).getByRole('button', { name: 'More tools' });
    expect(more.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-reactions-flyout][data-sheet]')).not.toBeNull();
    fireEvent.click(more);
    const item = within(screen.getByRole('menu', { name: 'More tools' })).getByRole(
      'menuitemradio',
      {
        name: 'Reactions',
      },
    );
    expect(item.getAttribute('aria-checked')).toBe('true');
  });
});
