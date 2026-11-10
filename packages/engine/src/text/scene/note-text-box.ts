// The note's sizing rules, placement and text fit live in @canvas/text, which agents measure notes
// with and the vector export places them by.
export {
  NOTE_FIT_FLOOR_PX,
  NOTE_PADDING,
  fitNoteText,
  fittedNoteHeight,
  noteBoxHeight,
  noteHeightFor,
  noteMinHeight,
  noteTextPlacement,
  noteWrapWidth,
  type NoteFit,
  type NoteFitInput,
  type NoteFitLayout,
} from '@canvas/text';
