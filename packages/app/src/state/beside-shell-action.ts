import type { ObjectId } from '@canvas/schema';

import type { BoardStyleAction } from './board-style-action.js';
import type { ToolPanelKeyAction } from './tool-panel-key.js';
import type { ToolPanelId } from './tool-panel-state.js';

/**
 * Start placing a comment, or stop (the floating dock's Comment and its key M). The
 * site's comment mode takes it (`useCommentKeyDispatch`); the reducer changes nothing.
 */
export interface ToggleCommentPlacingAction {
  /** Always `toggleCommentPlacing`. */
  readonly type: 'toggleCommentPlacing';
}

/**
 * Pan the view by an offset on screen (the minimap moves the view to where it is pressed
 * or dragged), keeping the zoom: as a two-finger drag of that offset would.
 */
export interface PanCameraAction {
  /** Always `panCamera`. */
  readonly type: 'panCamera';
  /** How far the board moves right on screen, CSS px. */
  readonly deltaXPx: number;
  /** How far the board moves down on screen, CSS px. */
  readonly deltaYPx: number;
}

/**
 * Zoom the view about a point on screen by a factor (a wheel on the minimap, about the
 * board point under it; the zoom control's 50 % and 200 %, about the view's centre), as a pinch
 * there would.
 */
export interface ZoomCameraAction {
  /** Always `zoomCamera`. */
  readonly type: 'zoomCamera';
  /** The point kept still, CSS px across the canvas (it may lie off it). */
  readonly centerXPx: number;
  /** The point kept still, CSS px down the canvas. */
  readonly centerYPx: number;
  /** The new zoom over the old: above 1 zooms in. */
  readonly scale: number;
}

/**
 * Open a floating dock tool's panel that has no interaction mode of its own (Image, by
 * its button or I). The reducer records the request (`ShellState.toolPanelRequest`); the
 * floating dock opens the panel.
 */
export interface OpenToolPanelAction {
  /** Always `openToolPanel`. */
  readonly type: 'openToolPanel';
  /** The panel. */
  readonly panel: ToolPanelId;
}

/**
 * Open or close the floating dock's Reactions flyout, or while drawing choose the eraser
 * (the floating dock's Reactions and its key E). The shell's reactions take it
 * (`useCommentKeyDispatch`); the reducer changes nothing.
 */
export interface ToggleReactionsAction {
  /** Always `toggleReactions`. */
  readonly type: 'toggleReactions';
  /** Pressed by its key (E), which while drawing chooses the eraser instead. */
  readonly isKey?: true;
}

/**
 * Move focus into the selection's properties popover (mod+/ on a floating whiteboard),
 * as Tab from the canvas does. The reducer counts the requests (`ShellState.popoverFocusRequests`);
 * the popover takes focus when the count changes while it shows.
 */
export interface FocusSelectionPopoverAction {
  /** Always `focusSelectionPopover`. */
  readonly type: 'focusSelectionPopover';
}

/** A range of a text's characters, UTF-16 code units. */
export interface CharacterRange {
  /** The range's first character. */
  readonly start: number;
  /** One past its last character. */
  readonly end: number;
}

/** The ranges of one text that a relink changes (`RelinkTextAction`). */
export interface RelinkTarget {
  /** The text, sticky, shape or connector whose text (or label) holds the link. */
  readonly id: ObjectId;
  /** Each range a whole stretch of characters carrying the link (`linkSpansOf`). */
  readonly ranges: readonly CharacterRange[];
}

/**
 * Change or remove a link on ranges of texts' characters (the link chip's and the Links
 * list's Edit and Remove): one `setTextRuns` batch over every text, so one undo step; the
 * characters stay as they are. Each range must still be exactly a stretch carrying `from` when
 * it runs, else nothing is written: a collaborator's edit since the chip or list showed it may
 * have moved the link. `DocumentPanels` runs it.
 */
export interface RelinkTextAction {
  /** Always `relinkText`. */
  readonly type: 'relinkText';
  /** The texts and the ranges in each. */
  readonly targets: readonly RelinkTarget[];
  /** The link the ranges carry now. */
  readonly from: string;
  /** The new link (already `normalizeLink`'s), or null to remove it. */
  readonly link: string | null;
}

/**
 * The actions a `ShellAction` carries from beside its own file: the board's named styles,
 * the floating dock's comment key and Reactions, its tool panels'
 * keys, the minimap's pan, panel requests, the popover's focus
 * key and a link's relink.
 */
export type BesideShellAction =
  | BoardStyleAction
  | ToggleCommentPlacingAction
  | ToggleReactionsAction
  | ToolPanelKeyAction
  | PanCameraAction
  | ZoomCameraAction
  | OpenToolPanelAction
  | FocusSelectionPopoverAction
  | RelinkTextAction;
