/**
 * Open the board-wide replacement of a missing font (the missing-fonts notice's
 * Replace…): the font the person then picks replaces the family everywhere the board names it,
 * in one undo step. A canvas action, so a viewer's is refused.
 */
export interface ReplaceMissingFontAction {
  /** The action. */
  readonly type: 'replaceMissingFont';
  /** The missing family, as the board stores it. */
  readonly family: string;
}
