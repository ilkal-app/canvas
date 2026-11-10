import { render, screen, type RenderResult } from '@testing-library/react';
import { vi, type Mock } from 'vitest';

import type { BoardMode } from '@canvas/schema';

import { commentContext, type CommentMode } from '../../comments/comment-context.js';
import { createDefaultShortcutRegistry } from '../../keymap/default-keymap.js';
import type { KeyboardPlatform } from '../../shortcuts/keyboard-platform.js';
import type { ShortcutRegistry } from '../../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../../state/shell-action.js';
import { INITIAL_SHELL_STATE, type ShellState } from '../../state/shell-reducer.js';
import { Dock } from '../dock.js';

/** The options of {@link renderDock}. */
export interface RenderDockOptions {
  readonly platform?: KeyboardPlatform;
  readonly state?: ShellState;
  readonly mode?: BoardMode;
  readonly registry?: ShortcutRegistry<ShellAction>;
  readonly comments?: CommentMode;
}

/** What {@link renderDock} rendered. */
export interface RenderedDock {
  /** The shell's dispatch. */
  readonly dispatch: Mock<(action: ShellAction) => void>;
  /** The host's mode handler. */
  readonly onModeChange: Mock<(mode: BoardMode) => void>;
  /** The render. */
  readonly view: RenderResult;
  /** The dock's toolbar. */
  readonly dock: HTMLElement;
}

/**
 * Renders the dock alone.
 *
 * @param options - The platform, state, mode, shortcuts and site comments.
 * @returns The handlers and the toolbar.
 */
export function renderDock(options: RenderDockOptions = {}): RenderedDock {
  const { platform = 'mac', state = INITIAL_SHELL_STATE, mode = 'whiteboard' } = options;
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const onModeChange = vi.fn<(mode: BoardMode) => void>();
  const view = render(
    <commentContext.Provider value={options.comments}>
      <Dock
        registry={options.registry ?? createDefaultShortcutRegistry(platform)}
        state={state}
        mode={mode}
        onModeChange={onModeChange}
        dispatch={dispatch}
      />
    </commentContext.Provider>,
  );
  return { dispatch, onModeChange, view, dock: screen.getByRole('toolbar', { name: 'Tools' }) };
}

/**
 * The words in a button's tooltip.
 *
 * @param button - The button.
 * @returns The tooltip's text.
 */
export function tooltipOf(button: HTMLElement): string {
  const id = button.getAttribute('aria-describedby') ?? '';
  return document.getElementById(id)?.textContent ?? '';
}

/**
 * A site comment mode for a member who may write.
 *
 * @param isPlacing - Whether the next click places a comment.
 * @returns The mode.
 */
export function writer(isPlacing = false): CommentMode {
  return {
    canWrite: true,
    isPlacing,
    isPanelOpen: false,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
  };
}
