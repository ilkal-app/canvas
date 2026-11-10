// CONTRACT: Comment is available in the commenter's floating dock.
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { commentContext } from '../comments/comment-context.js';
import { createFloatingShortcutRegistry } from '../keymap/floating-keymap.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';
import type { ToolPanelId } from '../state/tool-panel-state.js';

import { writer } from './__fixtures__/render-dock.js';
import { FloatingDock } from './floating-dock.js';
import type { AnyToolPanel } from './tool-panels/tool-panel-contribution.js';

const TOOLS = [
  ['Select', 'V', 'select'],
  ['Pan', 'H', 'hand'],
  ['Section', 'F', 'frame'],
  ['Shapes', 'S', 'shape'],
  ['Text', 'T', 'text'],
  ['Connector', 'C', 'connector'],
  ['Draw', 'P', 'draw'],
  ['Sticky note', 'N', 'sticky'],
] as const;

// The dock's own tool actions, without the registered panels' tool styles set on load ('s
// Draw panel; the panels have their own tests).
const NO_PANELS = new Map<ToolPanelId, AnyToolPanel>();

function renderFloatingDock(
  options: {
    canEdit?: boolean;
    canComment?: boolean;
    isPlacing?: boolean;
    activeTool?: typeof INITIAL_SHELL_STATE.activeTool;
  } = {},
) {
  const dispatch = vi.fn();
  const view = render(
    <commentContext.Provider
      value={
        options.canComment === undefined
          ? undefined
          : { ...writer(options.isPlacing), canWrite: options.canComment }
      }
    >
      <FloatingDock
        registry={createFloatingShortcutRegistry('mac')}
        state={{
          ...INITIAL_SHELL_STATE,
          canEdit: options.canEdit ?? true,
          activeTool: options.activeTool ?? INITIAL_SHELL_STATE.activeTool,
        }}
        dispatch={dispatch}
        panels={NO_PANELS}
      />
    </commentContext.Provider>,
  );
  return { dispatch, view, dock: screen.getByRole('toolbar', { name: 'Tools' }) };
}

function button(dock: HTMLElement, name: string): HTMLElement {
  return within(dock).getByRole('button', { name: new RegExp(`^${name}(?: \\(| —|$)`) });
}

afterEach(cleanup);

describe('the floating whiteboard dock', () => {
  it('groups the editor tools in design order and gives built tools registry hints', () => {
    const { dock } = renderFloatingDock({ canComment: true });
    expect(
      within(dock)
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-label')),
    ).toEqual(['Navigate', 'Set the stage', 'Collaborate']);
    expect(
      within(dock)
        .getAllByRole('button')
        .map((item) => item.getAttribute('aria-label')),
    ).toEqual([
      'Select (V)',
      'Pan (H)',
      'Section (F)',
      'Shapes (S)',
      'Image (I)',
      'Text (T)',
      'Connector (C)',
      'Draw (P)',
      'Sticky note (N)',
      'Comment (M)',
      'Reactions (E)',
    ]);
    for (const [name, key] of TOOLS) {
      const item = button(dock, name);
      expect(item.getAttribute('aria-keyshortcuts')).toBe(key);
      expect(
        document.getElementById(item.getAttribute('aria-describedby') ?? '')?.textContent,
      ).toContain(key);
    }
    expect(button(dock, 'Comment').getAttribute('aria-keyshortcuts')).toBe('M');
  });

  it('reduces the commenter and viewer docks to their permitted sections', () => {
    const commenter = renderFloatingDock({ canEdit: false, canComment: true });
    expect(
      within(commenter.dock)
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-label')),
    ).toEqual(['Navigate', 'Collaborate']);
    expect(
      within(commenter.dock)
        .getAllByRole('button')
        .map((item) => item.getAttribute('aria-label')),
    ).toEqual(['Select (V)', 'Pan (H)', 'Comment (M)', 'Reactions (E)']);
    const comment = within(commenter.dock).getByRole('button', { name: 'Comment (M)' });
    expect(comment.getAttribute('disabled')).toBeNull();
    expect(comment.getAttribute('aria-disabled')).toBeNull();
    expect(comment.getAttribute('aria-keyshortcuts')).toBe('M');
    expect(
      document.getElementById(comment.getAttribute('aria-describedby') ?? '')?.textContent,
    ).not.toContain('Commenters can’t place comments yet');
    commenter.view.unmount();
    const viewer = renderFloatingDock({ canEdit: false });
    expect(within(viewer.dock).getAllByRole('group')).toHaveLength(1);
    expect(
      within(viewer.dock)
        .getAllByRole('button')
        .map((item) => item.getAttribute('aria-label')),
    ).toEqual(['Select (V)', 'Pan (H)']);
    expect(viewer.dock.querySelectorAll('[data-dock-divider]')).toHaveLength(0);
  });

  it.each(TOOLS)('chooses %s by dispatching its tool action', (name, key, tool) => {
    const { dock, dispatch } = renderFloatingDock({ canComment: true, activeTool: 'hand' });
    expect(button(dock, name).getAttribute('aria-keyshortcuts')).toBe(key);
    fireEvent.click(button(dock, name));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'selectTool', tool });
  });

  // Image has no mode of its own under the floating dock; it opens its panel.
  it('opens the Image panel by dispatching its panel request', () => {
    const { dock, dispatch } = renderFloatingDock({ canComment: true, activeTool: 'hand' });
    expect(button(dock, 'Image').getAttribute('aria-keyshortcuts')).toBe('I');
    fireEvent.click(button(dock, 'Image'));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'openToolPanel', panel: 'image' });
  });

  it('toggles site comment placement and shows Comment pressed while placing', () => {
    const { dock, dispatch } = renderFloatingDock({ canComment: true, isPlacing: true });
    expect(button(dock, 'Comment').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button(dock, 'Comment'));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'toggleCommentPlacing' });
  });

  it('lets a commenter start placement with the dock Comment', () => {
    const { dock, dispatch } = renderFloatingDock({ canEdit: false, canComment: true });
    fireEvent.click(button(dock, 'Comment'));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'toggleCommentPlacing' });
  });

  it('dispatches Reactions and reselects pressed Select', () => {
    const { dock, dispatch } = renderFloatingDock({ canComment: true });
    const item = button(dock, 'Reactions');
    expect(item.getAttribute('aria-keyshortcuts')).toBe('E');
    fireEvent.click(item);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'toggleReactions' });
    dispatch.mockClear();
    fireEvent.click(button(dock, 'Select'));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'reselectTool', tool: 'select' });
  });

  it('omits Comment when the shell has no comment mode', () => {
    const { dock } = renderFloatingDock();
    expect(within(dock).queryByRole('button', { name: /^Comment/ })).toBeNull();
  });
});
