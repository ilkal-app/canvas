import type { BoardMode } from '@canvas/schema';

import { READ_ONLY_DOCKS, type DockEntry, type DockRole } from './dock-layout.js';

/**
 * One place in the compact bottom bar: one of the dock's entries. The mode
 * button went with the mode switcher at the cutover (D2).
 */
export type MobileBarEntry = DockEntry;

/**
 * What each board mode's compact bottom bar holds after the mode button, in order (
 * as the mobile design draws them: Whiteboard's select, note, shapes, lines, pen and comment). The other modes keep
 * five of their dock's tools and the comment button, so the bar is never wider than its seven
 * 48 px targets; their own mobile tools are out of the ticket's scope. The hand is left out:
 * on a touch screen two fingers pan in every tool.
 */
export const MOBILE_BAR_LAYOUTS: Readonly<Record<BoardMode, readonly DockEntry[]>> = {
  whiteboard: ['select', 'note', 'shapes', 'lines', 'pen', 'comment'],
  uiux: ['select', 'frame', 'shapes', 'text', 'pen', 'comment'],
  diagram: ['select', 'shapes', 'lines', 'text', 'note', 'comment'],
  slides: ['select', 'slide', 'text', 'shapes', 'lines', 'comment'],
  illustration: ['select', 'pen', 'pencil', 'brush', 'shapes', 'comment'],
  motion: ['select', 'keyframe', 'motion-path', 'easing', 'timeline', 'comment'],
};

/**
 * The compact bottom bar's entries for a mode and a role, in order: for an editor the mode's
 * {@link MOBILE_BAR_LAYOUTS}; for anyone else the dock's read-only set (`READ_ONLY_DOCKS`: the
 * select tool and the hand), as on the desktop. No mode button: a board's mode is set when it is
 * made (D2). Pure.
 *
 * @param mode - The board's mode.
 * @param role - Whose bar it is.
 * @returns The entries.
 */
export function mobileBarEntriesFor(mode: BoardMode, role: DockRole): readonly MobileBarEntry[] {
  return role === 'editor' ? MOBILE_BAR_LAYOUTS[mode] : READ_ONLY_DOCKS[role];
}
