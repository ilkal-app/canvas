/** Whether an undo history has steps to undo and to redo, as its subscribers see it. */
export interface UndoHistoryState {
  /** `true` when the history's `undo` would revert a step. */
  readonly canUndo: boolean;
  /** `true` when the history's `redo` would reapply a step. */
  readonly canRedo: boolean;
}
