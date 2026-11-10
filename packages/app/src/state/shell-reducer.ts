import type { ToolId } from '@canvas/tools';

import { INITIAL_DOCK_GROUP_TOOLS, withDockGroupTool, type DockGroupTools } from './dock-groups.js';
import { isEditingAction } from './editing-actions.js';
import { FLOATING_DOCK_TOOLS } from './floating-dock.js';
import type { CanvasAction, ShellAction } from './shell-action.js';
import { availableToolIds } from './tool-availability.js';
import type { RecordedToolPanelKey, ToolPanelKeyAction } from './tool-panel-key.js';
import type { ToolPanelId } from './tool-panel-state.js';
import { mergeStyle, type ToolStyle, type ToolStyles } from './tool-style.js';
import { DEFAULT_VIEW_PREFERENCES, type ViewPreferences } from './view-preferences.js';

/** A canvas action the shell received, numbered so that a repeat of the same action is new. */
export interface RecordedCanvasAction {
  /** The action. */
  readonly action: CanvasAction;
  /** Increases by one with every canvas action, starting at 1. */
  readonly sequence: number;
}

/**
 * The shell's own state: which tool is active and which tools can be, each creation tool's style,
 * which dialog is open, the person's view preferences (grid, snapping, and whether a delete takes
 * attached connectors), what the canvas was asked.
 */
export interface ShellState extends ViewPreferences {
  /** The tool the toolbar shows as pressed. */
  readonly activeTool: ToolId;
  /**
   * The tools that can be selected (those with an interaction mode, `TOOL_AVAILABILITY`); a
   * `selectTool` of any other changes nothing.
   */
  readonly availableTools: readonly ToolId[];
  /**
   * The style each creation tool gives new objects, as far as the person changed it in the style
   * panel while the tool was active and nothing was selected; a tool without an entry uses its
   * own defaults.
   */
  readonly toolStyles: ToolStyles;
  /**
   * The tool each flyout group's button stands for: the one last made active from the
   * group (the connector after `c`), its first until then.
   */
  readonly dockGroupTools: DockGroupTools;
  /**
   * The creation tools whose `ink` the person picked themselves (the Ink swatch of the colour
   * the tool creates with), which new objects keep as `ink` rather than taking a contrasting
   * colour over an object.
   */
  readonly pickedInk: Readonly<Partial<Record<ToolId, true>>>;
  /**
   * Whether the person may edit the board: the board connection's answer, through
   * `setEditable`. While false, the reducer ignores every editing action (`isEditingAction`),
   * so neither a shortcut, a button, a menu nor a panel reaches the canvas with one, and the
   * select tool stays active.
   */
  readonly canEdit: boolean;
  /** Whether the shortcut cheat sheet dialog is open. */
  readonly isCheatSheetOpen: boolean;
  /** Whether the developer overlay (frame timings and GPU memory) shows. */
  readonly isDeveloperOverlayOpen: boolean;
  /**
   * Whether the layers drawer is open over the canvas's left side: the person's own
   * choice, kept in the browser's storage (`loadLayersDrawerOpen`); closed at first.
   */
  readonly isLayersDrawerOpen: boolean;
  /**
   * Whether the person pinned the minimap open under the floating chrome (its toggle in
   * the zoom control, Shift+M); it also shows by itself while the view moves.
   */
  readonly isMinimapPinned: boolean;
  /**
   * How many times the board search sheet was asked to open (mod+f): the floating board
   * bar opens it, and moves focus into its field, when this changes.
   */
  readonly boardSearchRequests: number;
  /**
   * How many times focus was asked to move into the selection's properties popover (
   * mod+/): the popover takes focus when this changes while it shows.
   */
  readonly popoverFocusRequests: number;
  /**
   * The latest canvas action (navigation, selection, arrangement, history), for the engine
   * and tools to act on; undefined until the first one. Subscribers compare `sequence`.
   */
  readonly lastCanvasAction: RecordedCanvasAction | undefined;
  /**
   * The latest tool panel key pressed while its tool was active (P and E while
   * drawing), for the floating dock to change that panel's choices with; undefined until the
   * first. The dock compares `sequence`.
   */
  readonly lastToolPanelKey: RecordedToolPanelKey | undefined;
  /**
   * The latest request to open a floating dock panel (`openToolPanel`); the dock opens
   * the panel when `sequence` changes. Undefined until the first.
   */
  readonly toolPanelRequest?: {
    /** The panel asked for. */
    readonly panel: ToolPanelId;
    /** Rises by one with each request. */
    readonly sequence: number;
  };
}

/** The shell's state when it first mounts. */
export const INITIAL_SHELL_STATE: ShellState = {
  activeTool: 'select',
  availableTools: availableToolIds(),
  toolStyles: {},
  dockGroupTools: INITIAL_DOCK_GROUP_TOOLS,
  pickedInk: {},
  canEdit: true,
  isCheatSheetOpen: false,
  isDeveloperOverlayOpen: false,
  isLayersDrawerOpen: false,
  isMinimapPinned: false,
  boardSearchRequests: 0,
  popoverFocusRequests: 0,
  ...DEFAULT_VIEW_PREFERENCES,
  lastCanvasAction: undefined,
  lastToolPanelKey: undefined,
};

/**
 * Applies a shell action to the shell state, returning the next state; the input is never
 * changed, and an action that changes nothing returns the same object. While the person cannot
 * edit (`canEdit`), an editing action changes nothing; becoming unable to edit makes
 * the select tool active.
 *
 * @param state - The current state.
 * @param action - The action to apply.
 * @returns The next state.
 */
export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  if (!state.canEdit && isEditingAction(action)) return state;
  switch (action.type) {
    case 'setEditable':
      if (action.canEdit === state.canEdit) return state;
      return action.canEdit
        ? { ...state, canEdit: true }
        : { ...state, canEdit: false, activeTool: 'select' };
    case 'selectTool':
      if (!state.availableTools.includes(action.tool)) return state;
      if (action.style !== undefined) {
        return withGroupTool(withVariant(state, action.tool, action.style, action.replaces));
      }
      return state.activeTool === action.tool
        ? state
        : withGroupTool({ ...state, activeTool: action.tool });
    case 'setToolStyle':
      return {
        ...state,
        toolStyles: {
          ...state.toolStyles,
          [action.tool]: mergeStyle(state.toolStyles[action.tool], action.style),
        },
        pickedInk: withInkPick(state.pickedInk, action.tool, action.isInkPick),
      };
    case 'toggleCheatSheet':
      return { ...state, isCheatSheetOpen: !state.isCheatSheetOpen };
    case 'closeCheatSheet':
      return state.isCheatSheetOpen ? { ...state, isCheatSheetOpen: false } : state;
    case 'toggleDeveloperOverlay':
      return { ...state, isDeveloperOverlayOpen: !state.isDeveloperOverlayOpen };
    // The inspector drawer's state is the shell's (`useInspectorDrawer`), not the reducer's.
    case 'toggleInspector':
      return state;
    // The site's comment mode and the board's reactions take them (`useCommentKeyDispatch`).
    case 'toggleCommentPlacing':
    case 'toggleReactions':
      return state;
    case 'toolPanelKey':
      return withToolPanelKey(state, action);
    // A panel without a mode (the floating dock's Image) hands the canvas to Select meanwhile, so
    // a click while it shows places nothing of the tool before.
    case 'openToolPanel':
      return {
        ...shellReducer(state, { type: 'selectTool', tool: 'select' }),
        toolPanelRequest: {
          panel: action.panel,
          sequence: (state.toolPanelRequest?.sequence ?? 0) + 1,
        },
      };
    case 'toggleLayersDrawer':
      return { ...state, isLayersDrawerOpen: !state.isLayersDrawerOpen };
    case 'openBoardSearch':
      return { ...state, boardSearchRequests: state.boardSearchRequests + 1 };
    case 'focusSelectionPopover':
      return { ...state, popoverFocusRequests: state.popoverFocusRequests + 1 };
    case 'toggleDeleteConnectors':
      return { ...state, shouldDeleteConnectors: !state.shouldDeleteConnectors };
    // The grid and snapping toggles (mod+', mod+shift+') are view preferences the shell keeps
    // and hands the engine as state, not canvas actions for it to replay.
    case 'navigate':
      if (action.command === 'toggleGrid') return { ...state, isGridVisible: !state.isGridVisible };
      if (action.command === 'toggleMinimap') {
        return { ...state, isMinimapPinned: !state.isMinimapPinned };
      }
      if (action.command === 'toggleSnapping') {
        return { ...state, isSnappingOn: !state.isSnappingOn };
      }
      return recordCanvasAction(state, action);
    default:
      return recordCanvasAction(state, action);
  }
}

/**
 * Makes a tool active with fields of its style set (a tool variant, such as the arrow). With
 * `replaces`, a field is set only while the tool's style holds the value named there, so the
 * plain line resets the arrow's end cap and keeps a cap the person chose in the panel.
 *
 * @param state - The current state.
 * @param tool - The tool.
 * @param style - The fields to set.
 * @param replaces - The values a field must hold now to be set; every field is set if absent.
 * @returns The next state; the same state when the tool is active and its style already holds
 *   every field set (compared by identity, as a variant's fields are plain values).
 */
function withVariant(
  state: ShellState,
  tool: ToolId,
  style: ToolStyle,
  replaces: ToolStyle | undefined,
): ShellState {
  const own: Readonly<Record<string, unknown>> = { ...state.toolStyles[tool] };
  const replaced: Readonly<Record<string, unknown>> | undefined =
    replaces === undefined ? undefined : { ...replaces };
  const fields = Object.entries(style).filter(
    ([field]) => replaced === undefined || !(field in replaced) || own[field] === replaced[field],
  );
  const isHeld = fields.every(([field, value]) => own[field] === value);
  if (state.activeTool === tool && isHeld) return state;
  const patch = Object.fromEntries(fields) as ToolStyle;
  return {
    ...state,
    activeTool: tool,
    toolStyles: { ...state.toolStyles, [tool]: mergeStyle(state.toolStyles[tool], patch) },
  };
}

/**
 * Records the active tool as its flyout group's (the lines group's connector), if it has one.
 *
 * @param state - The state after a tool was made active.
 * @returns The state, the same object when the group already stood for the tool.
 */
function withGroupTool(state: ShellState): ShellState {
  const dockGroupTools = withDockGroupTool(state.dockGroupTools, state.activeTool);
  return dockGroupTools === state.dockGroupTools ? state : { ...state, dockGroupTools };
}

/**
 * Applies a tool panel's key: while the panel's tool is active it is recorded as the
 * latest, with the next sequence number, for the floating dock to apply to the panel's choices;
 * otherwise a key that chooses the tool makes it active (P chooses Draw) and any other changes
 * nothing (E outside Draw).
 *
 * @param state - The current state.
 * @param action - The key.
 * @returns The next state.
 */
function withToolPanelKey(state: ShellState, action: ToolPanelKeyAction): ShellState {
  const { mode } = FLOATING_DOCK_TOOLS[action.tool];
  if (mode === undefined) return state;
  if (state.activeTool !== mode) {
    return action.shouldChooseTool
      ? shellReducer(state, { type: 'selectTool', tool: mode })
      : state;
  }
  const sequence = (state.lastToolPanelKey?.sequence ?? 0) + 1;
  return { ...state, lastToolPanelKey: { tool: action.tool, key: action.key, sequence } };
}

/**
 * Records a canvas action as the latest, with the next sequence number.
 *
 * @param state - The current state.
 * @param action - The action.
 * @returns The next state.
 */
function recordCanvasAction(state: ShellState, action: CanvasAction): ShellState {
  return {
    ...state,
    lastCanvasAction: { action, sequence: (state.lastCanvasAction?.sequence ?? 0) + 1 },
  };
}

/**
 * The tools whose `ink` the person picked, after a tool style change: the tool added for an Ink
 * pick, removed for a fixed colour's, the same object when it says nothing or changes nothing.
 *
 * @param picked - The tools so far.
 * @param tool - The tool whose style changed.
 * @param isInkPick - The change's pick, if any.
 * @returns The tools now.
 */
function withInkPick(
  picked: ShellState['pickedInk'],
  tool: ToolId,
  isInkPick: boolean | undefined,
): ShellState['pickedInk'] {
  if (isInkPick === undefined || (picked[tool] === true) === isInkPick) return picked;
  if (isInkPick) return { ...picked, [tool]: true };
  return Object.fromEntries(Object.entries(picked).filter(([name]) => name !== tool));
}
