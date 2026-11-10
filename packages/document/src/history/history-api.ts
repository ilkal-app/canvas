// The undo history's public API, re-exported from the package root (`src/index.ts`): the root
// barrel keeps under its line limit by re-exporting areas through files like this one, as
// `meta/meta-api.ts` does.
export { isOwnedBy } from './origin-ownership.js';
export { createHistory } from './undo-manager.js';
export { afterParts, forwardUndoSteps, isApplyingInParts, runAsOneStep } from './undo-groups.js';
export type {
  RestoreReport,
  UndoHistory,
  UndoHistoryOptions,
  UndoHistoryState,
  UndoOmission,
} from './undo-manager.js';
export type { OperatedWriters } from './operated-writes.js';
export type { UndoProtection } from './protection.js';
