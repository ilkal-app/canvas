// The shell's command vocabularies a `ShellAction` carries (`shell-action.ts` re-exports them):
// navigation, selection, arrangement and history.

/** Camera and view commands. */
export type NavigationCommand =
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomToActualSize'
  | 'zoomToFit'
  | 'zoomToSelection'
  | 'toggleGrid'
  | 'toggleSnapping'
  | 'toggleMinimap'
  | 'previousPage'
  | 'nextPage';

/**
 * Commands on the current selection and the clipboard. `deleteAndHeal`
 * (Shift+Delete) is vector edit's delete that joins the neighbours of deleted points; with
 * the select tool it deletes as Delete does.
 */
export type SelectionCommand =
  | 'selectAll'
  | 'selectSameType'
  | 'deselect'
  | 'delete'
  | 'deleteAndHeal'
  | 'duplicate'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'toggleLock'
  | 'activate'
  | 'cropImageFill'
  | 'toggleBold'
  | 'toggleItalic'
  | 'toggleUnderline'
  | 'toggleStrikethrough';

/**
 * Grouping, z-order, alignment and distribution commands, and making a
 * component of the selection.
 */
export type ArrangeCommand =
  | 'group'
  | 'ungroup'
  | 'createComponent'
  | 'bringForward'
  | 'sendBackward'
  | 'bringToFront'
  | 'sendToBack'
  | 'alignLeft'
  | 'alignCentre'
  | 'alignRight'
  | 'alignTop'
  | 'alignMiddle'
  | 'alignBottom'
  | 'distributeHorizontally'
  | 'distributeVertically'
  | 'tidyUp'
  | 'stackSticky';

/** Undo and redo. */
export type HistoryCommand = 'undo' | 'redo';
