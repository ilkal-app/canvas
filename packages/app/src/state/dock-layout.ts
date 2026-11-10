import type { BoardMode } from '@canvas/schema';

import type { WhiteboardChrome } from '../shell/whiteboard-chrome.js';

import type { DockButtonId } from './dock-buttons.js';
import { DOCK_GROUP_IDS, type DockGroupId } from './dock-groups.js';

/** One place in the dock: a button, or a flyout group's button. */
export type DockEntry = DockButtonId | DockGroupId;

/**
 * What each board mode's dock holds, in order (Figma "Dock ·
 * modes & flyouts"). Buttons whose feature is not built show disabled (`TOOL_AVAILABILITY`).
 */
export const DOCK_LAYOUTS: Readonly<Record<BoardMode, readonly DockEntry[]>> = {
  whiteboard: ['select', 'hand', 'note', 'text', 'shapes', 'lines', 'image', 'pen', 'comment'],
  uiux: [
    'select',
    'hand',
    'frame',
    'shapes',
    'text',
    'image',
    'component',
    'pen',
    'prototype',
    'comment',
  ],
  diagram: ['select', 'hand', 'shapes', 'lines', 'text', 'note', 'diagram', 'comment'],
  slides: ['select', 'hand', 'slide', 'text', 'shapes', 'lines', 'image', 'present', 'comment'],
  illustration: [
    'select',
    'hand',
    'pen',
    'pencil',
    'brush',
    'shapes',
    'shape-builder',
    'eraser',
    'comment',
  ],
  motion: ['select', 'hand', 'keyframe', 'motion-path', 'easing', 'timeline', 'comment'],
};

/** The mode a board without one, and the standalone shell, starts in. */
export const DEFAULT_BOARD_MODE: BoardMode = 'whiteboard';

/**
 * Whose dock it is: an `editor` (or owner) gets the switcher and the mode's whole tool set; a
 * `commenter` and a `viewer` (a read-only shell) get no switcher and no creation
 * tool ({@link READ_ONLY_DOCKS}); a commenter replies and resolves in the comments panel.
 */
export type DockRole = 'editor' | 'commenter' | 'viewer';

/**
 * The buttons a role that cannot edit keeps, from whichever mode's dock: the select tool and the
 * hand, which only look and pan.
 */
export const READ_ONLY_DOCKS: Readonly<Record<Exclude<DockRole, 'editor'>, readonly DockEntry[]>> =
  {
    // No comment button yet: a pin is a document object the relay refuses from a commenter.
    commenter: ['select', 'hand'],
    viewer: ['select', 'hand'],
  };

/**
 * The dock's entries for a mode and a role, in order: the mode's whole set for an editor, only
 * those of {@link READ_ONLY_DOCKS} for anyone else. Pure.
 *
 * @param mode - The board's mode.
 * @param role - Whose dock it is.
 * @returns The entries.
 */
export function dockEntriesFor(mode: BoardMode, role: DockRole): readonly DockEntry[] {
  const layout = DOCK_LAYOUTS[mode];
  if (role === 'editor') return layout;
  const kept = READ_ONLY_DOCKS[role];
  return layout.filter((entry) => kept.includes(entry));
}

/** Which drawers a board mode's shell has. */
export interface PanelLayout {
  /** The layers drawer over the canvas's left side (alt+1, the zoom control's toggle). */
  readonly hasLayersDrawer: boolean;
  /** The inspector drawer in the right-hand slot (alt+8, opening on a selection). */
  readonly hasInspector: boolean;
}

const WITH_DRAWERS: PanelLayout = { hasLayersDrawer: true, hasInspector: true };

/**
 * Each board mode's drawers under the floating chrome: the whiteboard has none, its
 * properties moving to the selection popover; the other modes keep both until their own
 * projects change them.
 */
export const PANEL_LAYOUTS: Readonly<Record<BoardMode, PanelLayout>> = {
  whiteboard: { hasLayersDrawer: false, hasInspector: false },
  uiux: WITH_DRAWERS,
  diagram: WITH_DRAWERS,
  illustration: WITH_DRAWERS,
  motion: WITH_DRAWERS,
  slides: WITH_DRAWERS,
};

/**
 * A board mode's drawers under a chrome: both for every mode under the classic chrome, the
 * mode's {@link PANEL_LAYOUTS} under the floating one. Pure.
 *
 * @param mode - The board's mode.
 * @param chrome - The shell's chrome.
 * @returns Which drawers the shell has.
 */
export function panelLayoutFor(mode: BoardMode, chrome: WhiteboardChrome): PanelLayout {
  return chrome === 'floating' ? PANEL_LAYOUTS[mode] : WITH_DRAWERS;
}

/**
 * Whether a dock entry is a flyout group.
 *
 * @param entry - The entry.
 * @returns True for `shapes` and `lines`.
 */
export function isDockGroup(entry: DockEntry): entry is DockGroupId {
  return (DOCK_GROUP_IDS as readonly string[]).includes(entry);
}
