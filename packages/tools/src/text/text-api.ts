// The text area's public API (the text editor, its session and restyling), re-exported by the
// package entry, src/index.ts, which would otherwise pass 400 lines.
export {
  applyListTrigger,
  beginComposition,
  changeListLevel,
  deleteBackward,
  deleteForward,
  insertParagraphBreak,
  insertStyled,
  insertText,
  selectionListOf,
  setList,
  setStyle,
  toggleList,
} from './editor.js';
export { listParagraphsOf } from './paragraph-edits.js';
export {
  hardLineAt,
  moveHardLine,
  moveHorizontal,
  moveToHardLineEdge,
  moveToLineEdge,
  moveToTextEdge,
  moveVertical,
  selectAll,
  selectRange,
  selectWord,
  setCaret,
} from './editor-navigation.js';
export type { CaretUnit } from './editor-navigation.js';
export {
  createEditorState,
  hasSelection,
  insertStyleOf,
  selectedContent,
  selectionRange,
} from './editor-state.js';
export type { EditorState } from './editor-state.js';
export { followDocument } from './editor-sync.js';
export { applyStyle, commonStyle } from './runs/apply-style.js';
export {
  isSameStyleField,
  NO_LETTER_SPACING,
  shownTextStyle,
  TEXT_STYLE_FIELDS,
  type ShownTextStyle,
} from './runs/style-fields.js';
export type { TextStyleField } from './runs/style-fields.js';
export { normalizeRuns } from './runs/normalize-runs.js';
export {
  MAX_RUNS_PAYLOAD_CHARS,
  parseRunsPayload,
  RUNS_MIME_TYPE,
  serializeRunsPayload,
} from './runs/runs-payload.js';
export type { RunsPayload } from './runs/runs-payload.js';
export { insertRuns, sliceRuns, spliceRuns } from './runs/splice-runs.js';
export { maxFontSize, styleAt, styleOfCharacter } from './runs/style-at.js';
export type { TextStylePatch } from './runs/text-style-patch.js';
export { wordRangeAt } from './word-ranges.js';
export { moveCaret } from './caret-motion.js';
export type { CaretMotion } from './caret-motion.js';
export { composedContent } from './composed-content.js';
export type { ComposedContent, Composition } from './composed-content.js';
export { MIN_TEXT_BOX_WIDTH, newTextObject } from './new-text-object.js';
export type { NewTextObject } from './new-text-object.js';
export { copySelection, cutSelection, pasteInto } from './session-clipboard.js';
export { deleteBy, replaceText, type DeletionUnit } from './session-edits.js';
export { rectToWorld, textFrameOf, textOriginIn, worldToLocal } from './text-box-frame.js';
export { linkAtLayoutPoint, linkHitAtLayoutPoint, sessionLinkAt } from './run-link-at.js';
export type { LinkHit } from './run-link-at.js';
export { linkSpansOf } from './runs/link-spans.js';
export type { LinkSpan } from './runs/link-spans.js';
export {
  editedContentOf,
  isEditableTextObject,
  isLabelledObject,
  isTextBoxObject,
  withEditedContent,
} from './text-box-object.js';
export type {
  EditableTextObject,
  EditedContent,
  LabelledObject,
  TextBoxObject,
} from './text-box-object.js';
export type { LocalRect } from './text-box-frame.js';
export {
  editedPlacementOf,
  layoutContent,
  measuredSize,
  MIN_TEXT_BOX_SIZE,
  wrapWidthOf,
  writeTextContent,
} from './text-content-writer.js';
export type { TextContent } from './text-content-writer.js';
export { CARET_WIDTH_PX, TEXT_SELECTION_FILL, textEditingRects } from './text-editing-rects.js';
export type { TextEditingRectsInput } from './text-editing-rects.js';
export { TextMode } from './text-mode.js';
export type { TextModeStart } from './text-mode.js';
export type {
  TextLayoutInput,
  TextLayoutService,
  TextModeContext,
  TypingCapture,
} from './text-mode-context.js';
export {
  alignTextObjects,
  directTextObjects,
  commonStyleOfObjects,
  runStylesOfObjects,
  sharedStyleOf,
  textObjectsOf,
  isBoldWeight,
  lockedLeftNotice,
  previewTextObjects,
  restyleTextObjects,
  toggledItalic,
  toggledStrikethrough,
  toggledUnderline,
  toggledWeight,
} from './text-restyle.js';
export { replaceFontFamilyOnBoard, replacementLeftNotice } from './text-font-replace.js';
export { LOCKED_WHILE_EDITING_NOTICE, TextEditingSession } from './text-session.js';
export { isOnSessionBox, sessionCaretBox, sessionOverlayRects } from './text-session-geometry.js';
export type { CaretColors } from './text-session-geometry.js';
