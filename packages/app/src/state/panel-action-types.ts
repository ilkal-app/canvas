// The panel actions a `ShellAction` carries beside its own vocabularies, re-exported together
// for the package root: the colour-token actions, the variant-set actions and
// the board-wide replacement of a missing font, the floating dock's comment key
// and Reactions, its tool panels' keys, the minimap's pan
// panel requests and a link's relink.

export type {
  BesideShellAction,
  CharacterRange,
  FocusSelectionPopoverAction,
  OpenToolPanelAction,
  PanCameraAction,
  RelinkTarget,
  RelinkTextAction,
  ToggleCommentPlacingAction,
  ToggleReactionsAction,
  ZoomCameraAction,
} from './beside-shell-action.js';
export type { BoardStyleAction } from './board-style-action.js';
export type { ColorTokenAction } from './color-token-action.js';
export type { ReplaceMissingFontAction } from './font-actions.js';
export type { VariantComponentAction } from './variant-action.js';
export type { RecordedToolPanelKey, ToolPanelKey, ToolPanelKeyAction } from './tool-panel-key.js';
export type { ToolPanelId } from './tool-panel-state.js';
