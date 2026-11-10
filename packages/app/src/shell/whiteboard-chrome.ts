import { createContext, useContext } from 'react';

import type { BoardMode } from '@canvas/schema';

/**
 * Which chrome the shell draws around the canvas: `floating`, the whiteboard
 * design's floating chrome (board bar, presence, dock, zoom and Facilitate card over a full-bleed
 * canvas), on every whiteboard board since the cutover; `classic`, the dock and
 * drawers, on design and slides boards (`chromeForMode`).
 */
export type WhiteboardChrome = 'classic' | 'floating';

/** Every {@link WhiteboardChrome}, in the order the harness lists them. */
export const WHITEBOARD_CHROMES: readonly WhiteboardChrome[] = ['classic', 'floating'];

/**
 * What the shell says when a shortcut asks for a drawer a whiteboard board does not have under
 * the floating chrome (alt+1, alt+8).
 */
export const NOT_IN_WHITEBOARD_NOTICE = 'Layers and the inspector aren’t on whiteboard boards';

/**
 * The shell's chrome for the components inside it (`AppShell` provides the chrome its board
 * shows, `chromeForMode`); `classic` outside a shell, where no board's mode says otherwise: the
 * site's pages and the dialogs beside a board's shell (which take the site's own scope) keep their
 * look whatever the shell's default.
 */
export const whiteboardChromeContext = createContext<WhiteboardChrome>('classic');

/**
 * The chrome of the shell this component is in, for a surface that draws differently (or not
 * at all) under the floating chrome.
 *
 * @returns The shell's chrome; `classic` outside a shell.
 */
export function useWhiteboardChrome(): WhiteboardChrome {
  return useContext(whiteboardChromeContext);
}

/**
 * The attributes the shell's root carries for its chrome: `data-whiteboard-chrome="floating"`
 * under the floating chrome, none under the classic one, so the classic shell's DOM is unchanged.
 *
 * @param chrome - The host's chrome, if it names one.
 * @returns The root's attributes.
 */
export function chromeRootAttributes(chrome: WhiteboardChrome | undefined): {
  readonly 'data-whiteboard-chrome'?: 'floating';
} {
  return chrome === 'floating' ? { 'data-whiteboard-chrome': 'floating' } : {};
}

/**
 * The chrome a board shows (D1, 2026-10-22): the floating whiteboard chrome only on a
 * whiteboard board; a design or slides board keeps the classic chrome whatever its host names, so
 * every surface that reads the chrome alone (the top bar, the presence bar, the board title, the
 * engine's selection, the icons) leaves those boards as they were. Pure.
 *
 * @param chrome - The chrome the host names.
 * @param mode - The board's mode shown.
 * @returns `floating` for a whiteboard board under the floating chrome, else `classic`.
 */
export function chromeForMode(chrome: WhiteboardChrome, mode: BoardMode): WhiteboardChrome {
  return chrome === 'floating' && mode === 'whiteboard' ? 'floating' : 'classic';
}
