import type {
  ArrangeCommand,
  ComponentCommand,
  SelectionCommand,
  ShellAction,
} from './shell-action.js';

/**
 * Which selection commands change the board: deleting, duplicating, cutting, pasting, locking,
 * cropping an image fill and the text style keys do; selecting, deselecting, copying and Enter do not (Enter on a text
 * opens no editor for a viewer: the canvas's router starts no mode).
 */
const IS_EDITING_SELECTION: Readonly<Record<SelectionCommand, boolean>> = {
  selectAll: false,
  selectSameType: false,
  deselect: false,
  copy: false,
  activate: false,
  cropImageFill: true,
  delete: true,
  deleteAndHeal: true,
  duplicate: true,
  cut: true,
  paste: true,
  toggleLock: true,
  toggleBold: true,
  toggleItalic: true,
  toggleUnderline: true,
  toggleStrikethrough: true,
};

/**
 * Every arrange command (group, create component, order, align, distribute, tidy up) moves,
 * restacks or wraps objects.
 */
const IS_EDITING_ARRANGE: Readonly<Record<ArrangeCommand, true>> = {
  group: true,
  ungroup: true,
  createComponent: true,
  bringForward: true,
  sendBackward: true,
  bringToFront: true,
  sendToBack: true,
  alignLeft: true,
  alignCentre: true,
  alignRight: true,
  alignTop: true,
  alignMiddle: true,
  alignBottom: true,
  distributeHorizontally: true,
  distributeVertically: true,
  tidyUp: true,
  stackSticky: true,
};

/** Which component commands change the board: all but going to a main, which only looks. */
const IS_EDITING_COMPONENT: Readonly<Record<ComponentCommand, boolean>> = {
  setOverride: true,
  resetOverrides: true,
  setScale: true,
  detach: true,
  placeInstance: true,
  placeInstanceAt: true,
  rename: true,
  setSwapOptions: true,
  goToMain: false,
  setVariant: true,
  setVariantAxes: true,
  setPreset: true,
  resetPreset: true,
  previewPreset: false,
};

/**
 * Whether a shell action is one a person who cannot edit the board may not take (a viewer or a
 * commenter): making a creation tool active or setting its style, a command that
 * changes the board (delete, duplicate, cut, paste, lock, the text style keys), every arrange
 * command, every component command but going to a main, undo and redo, a restyle, a layout change, a layers row's lock, a layers drop and a colour token change. Navigation, selection, copy, the
 * cheat sheet, the developer overlay and the arrow keys are not: with a viewer's selection the
 * arrows pan the view rather than nudge (`EngineDocument.runCanvasAction`). The one list the
 * shell's reducer and the engine's canvas actions are both gated by, so a shortcut cannot do
 * what a hidden button cannot. Every command is listed, so a new one fails to type-check here.
 * Pure.
 *
 * @param action - The action.
 * @returns True when it edits the board, or prepares to.
 */
export function isEditingAction(action: ShellAction): boolean {
  switch (action.type) {
    case 'selectTool':
    case 'reselectTool':
      // The select tool and the hand only look and pan: a viewer may take both.
      return action.tool !== 'select' && action.tool !== 'hand';
    case 'setToolStyle':
    case 'history':
    case 'style':
    case 'layout':
    case 'toggleLockOf':
    case 'placeLayers':
    case 'colorToken':
    case 'autoLayout':
    case 'fitToContent':
    case 'linkCard':
    case 'replaceImage':
    case 'relinkText':
    case 'replaceMissingFont':
    // A tool panel's key chooses its creation tool or changes that tool's style.
    case 'toolPanelKey':
      return true;
    case 'selection':
      return IS_EDITING_SELECTION[action.command];
    case 'arrange':
      return IS_EDITING_ARRANGE[action.command];
    case 'component':
      return IS_EDITING_COMPONENT[action.command];
    case 'navigate':
    case 'frame':
    case 'panCamera':
    case 'zoomCamera':
    case 'nudge':
    case 'toggleCheatSheet':
    case 'closeCheatSheet':
    case 'toggleDeveloperOverlay':
    case 'toggleInspector':
    case 'toggleCommentPlacing':
    case 'openToolPanel':
    case 'toggleReactions':
    case 'toggleLayersDrawer':
    case 'openBoardSearch':
    case 'focusSelectionPopover':
    // A preference of the person's, not an edit: a viewer may set it for when they can edit.
    case 'toggleDeleteConnectors':
    case 'setEditable':
      return false;
  }
}
