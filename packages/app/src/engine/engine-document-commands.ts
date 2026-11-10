import { yieldToBrowser } from '@canvas/collab';
import {
  deleteObjectsCommand,
  SYSTEM_ORIGIN,
  type CommandEnvironment,
  type CommandError,
  type DocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import { countCopied, isStoreRunning, type RestoreReport } from '@canvas/document';
import type { BoardObject } from '@canvas/schema';
import {
  farSkipOf,
  groupsHoldingLocked,
  planArrange,
  runArrange,
  transformableIds,
  type SelectController,
} from '@canvas/tools';

import { BUSY_NOTICE } from '../notices/busy-notices.js';
import { farObjectsNotice } from '../notices/far-notice.js';
import { leftOutNotice } from '../notices/left-out-notice.js';
import type { NoticeSink } from '../notices/notice-outline.js';
import type { ArrangeCommand, HistoryCommand, SelectionCommand } from '../state/shell-action.js';

import { componentDeletionOf } from './component-deletion.js';
import type { DeletionConfirmations } from './deletion-confirmations.js';
import type { EditHistory } from './engine-document-types.js';
import { runCreateComponent } from './run-create-component.js';
import { runGrouping } from './run-grouping.js';
import { runStepped, stagingFor, stoppedOrFault } from './run-stepped.js';
import { reorderSelection, toggleSelectionLock } from './selection-arrange.js';
import { stackSticky } from './stack-sticky.js';

/**
 * What the document side's selection and arrange shortcuts act on: the document, whom their
 * commands are attributed to, the select tool whose selection they take, and where a refusal
 * the person should know about is told.
 */
export interface DocumentCommandContext {
  /** The document. */
  readonly store: DocumentStore;
  /** Who the commands are attributed to. */
  readonly origin: TransactionOrigin;
  /** The command clock and id generator. */
  readonly environment: CommandEnvironment;
  /** The select tool: its selection, and the selection commands it runs itself. */
  readonly controller: SelectController;
  /** Receives the sentence the shell shows when an action does nothing. */
  readonly onNotice?: NoticeSink;
  /**
   * The whole board as the person writes to it from the page shown (`PageBoardStore`), where
   * deletes and create component run and whose mains a new main's name counts;
   * `store` when absent.
   */
  readonly definitions?: DocumentStore | undefined;
  /**
   * Where a delete that would detach instances waits for the person's answer (ruling
   * 6); deletes go ahead at once when absent.
   */
  readonly deletions?: DeletionConfirmations;
  /** Receives the errors of a delete the document refused; nothing is said when absent. */
  readonly onCommandRefused?: ((errors: readonly CommandError[]) => void) | undefined;
  /** Whether the person may still edit when a delete they confirmed runs; always when absent. */
  readonly canEdit?: () => boolean;
  /** Whether the chrome has the design tools (`EngineDocumentOptions.hasDesignTools`). */
  readonly hasDesignTools?: (() => boolean) | undefined;
}

/**
 * The whole board as the person writes to it from the page shown, where a command that reads
 * across pages runs.
 *
 * @param context - The document and the whole board.
 * @returns The whole board, or the document when it shows the whole board.
 */
function boardOf(context: DocumentCommandContext): DocumentStore {
  return context.definitions ?? context.store;
}

/**
 * Deletes the selection's movable objects as the select tool would (`deleteSelection`), but over
 * the whole board (a group holding a locked object is left, and the shell told why). Not
 * mid-drag.
 *
 * @param context - The document, the select tool and the notice.
 */
function deleteSelected(context: DocumentCommandContext): void {
  const { controller, origin, environment } = context;
  if (controller.isGesturing) return;
  // A confirmation answered while a stepped run holds the store writes nothing.
  if (isStoreRunning(boardOf(context))) {
    context.onNotice?.(BUSY_NOTICE);
    return;
  }
  const { ids } = controller.selection;
  // A group holding a locked object is not deleted, as a locked object is not.
  const movable = transformableIds(ids, controller.source);
  if (movable.length > 0) {
    // Over the whole board: a deleted main's instances on other pages are detached.
    // A part per task, the store held meanwhile.
    const input = { ids: movable, connectorPolicy: controller.connectorPolicy };
    const handlers = {
      ...(context.onCommandRefused === undefined ? {} : { onRefused: context.onCommandRefused }),
      onNotice: (message: string) => context.onNotice?.(message),
    };
    // Counted with the descendants the delete takes with it: one large group is a large delete.
    const staging = stagingFor(countCopied(boardOf(context).read(), movable));
    runStepped(
      boardOf(context),
      origin,
      deleteObjectsCommand,
      input,
      environment,
      handlers,
      staging,
    );
  }
  const held = groupsHoldingLocked(ids, controller.source);
  if (held.length > 0) {
    context.onNotice?.(
      held.length === 1
        ? 'Not deleted: the group contains a locked object.'
        : 'Not deleted: those groups contain a locked object.',
    );
  }
}

/**
 * Deletes the selection, first asking the person when that would delete a main whose instances
 * would become plain objects (ruling 6): the delete runs once they confirm, if they may
 * still edit and the selection is still the one they were asked about.
 *
 * @param context - The document, the select tool, the confirmations and the notice.
 */
function deleteSelectionAsking(context: DocumentCommandContext): void {
  const { controller, deletions } = context;
  const asked = controller.selection.ids;
  const deletion = deletions && componentDeletionOf(boardOf(context), asked);
  if (deletion === undefined) {
    deleteSelected(context);
    return;
  }
  deletions?.ask(deletion, () => {
    const { ids } = controller.selection;
    const isSame = ids.length === asked.length && ids.every((id, index) => id === asked[index]);
    if (isSame && context.canEdit?.() !== false) deleteSelected(context);
  });
}

/**
 * Runs a selection command: select all, select same type, deselect
 * (Escape: cancels a drag first, else leaves an entered group), delete (a group holding a
 * locked object is left, and the shell told why; a main with instances asks first),
 * lock or unlock (`toggleSelectionLock`, one command, not mid-drag), and Enter (`activate`: the
 * one selected object's own mode). Every command is listed, so a new one fails to type-check
 * here. Main thread.
 *
 * @param context - The document, origin, environment and select tool.
 * @param command - The command.
 * @param zoom - The camera zoom.
 * @returns Whether the command was handled here.
 */
export function runSelectionCommand(
  context: DocumentCommandContext,
  command: SelectionCommand,
  zoom: number,
): boolean {
  const { controller } = context;
  switch (command) {
    case 'selectAll':
      controller.selectAll();
      return true;
    case 'selectSameType':
      controller.selectSameType();
      return true;
    case 'deselect':
      controller.handle({ kind: 'escape' }, zoom);
      return true;
    // Shift+Delete deletes as Delete does unless vector edit took it.
    case 'deleteAndHeal':
    case 'delete':
      deleteSelectionAsking(context);
      return true;
    case 'toggleLock':
      if (!controller.isGesturing) toggleSelectionLock(context, controller.selection.ids);
      return true;
    case 'activate':
      // Enter: the select tool activates the one selected object.
      controller.handle({ kind: 'enter' }, zoom);
      return true;
    // The tools' (`DocumentTools.runKey`): fill crop mode on the one selected object.
    case 'cropImageFill':
      return false;
    // The text tools' (`DocumentTools.runKey` takes them first): bold, italic, underline and strikethrough.
    case 'toggleBold':
    case 'toggleItalic':
    case 'toggleUnderline':
    case 'toggleStrikethrough':
      return false;
    // The clipboard's: EngineClipboard and the shell's clipboard router.
    case 'duplicate':
    case 'copy':
    case 'cut':
    case 'paste':
      return false;
  }
}

/**
 * Runs an arrange command on the select tool's selection, one command
 * and one undo step each, and none mid-drag: the six alignments, the two distributions and tidy
 * up (`planArrange`: one `moveObjects`, nothing when nothing would move; a group holding a
 * locked object is left out and the shell told why), the four order
 * commands on the selection's largest same-parent subset (`reorderSelection`; the shell is told
 * how many selected objects were left where they were), group and ungroup (`runGrouping`,
 *), and create component (`runCreateComponent`). Every command is listed, so a
 * new one fails to type-check here. Main thread.
 *
 * @param context - The document, origin, environment, select tool and notice.
 * @param command - The command.
 * @param zoom - The camera's zoom, for the select tool (Shift+N starts editing the new note).
 * @returns True: every arrange command is the document side's.
 */
export function runArrangeCommand(
  context: DocumentCommandContext,
  command: ArrangeCommand,
  zoom = 1,
): boolean {
  const { controller } = context;
  if (controller.isGesturing) return true;
  const { ids } = controller.selection;
  switch (command) {
    case 'stackSticky':
      return stackSticky(context, zoom);
    case 'alignLeft':
    case 'alignCentre':
    case 'alignRight':
    case 'alignTop':
    case 'alignMiddle':
    case 'alignBottom':
    case 'distributeHorizontally':
    case 'distributeVertically':
    case 'tidyUp': {
      const plan = planArrange(command, ids, controller.source);
      if (plan) runArrange(context.store, context.origin, context.environment, plan);
      // Objects placed far away are left out of an arrangement, and the person is told.
      const skip = farSkipOf(ids, controller.source);
      if (skip) context.onNotice?.(farObjectsNotice(skip));
      // A group holding a locked object is left out, as a locked object is.
      if (groupsHoldingLocked(ids, controller.source).length > 0) {
        context.onNotice?.('Not moved: a group contains a locked object.');
      }
      return true;
    }
    case 'bringToFront':
    case 'sendToBack':
    case 'bringForward':
    case 'sendBackward': {
      // Only the largest same-parent subset moves; the person is told about the rest.
      const { leftOutIds } = reorderSelection(context, command, ids);
      if (leftOutIds.length > 0) context.onNotice?.(leftOutNotice(leftOutIds.length));
      return true;
    }
    case 'group':
    case 'ungroup':
      runGrouping(command, context);
      return true;
    case 'createComponent':
      // A whiteboard has no components: taken, and nothing made.
      if (context.hasDesignTools?.() !== false) runCreateComponent(context);
      return true;
  }
}

/**
 * The sentence for an undo or redo that did not bring back whole objects, because they hold a
 * value the relay refuses (fix round 1): a count only, no object content.
 *
 * @param isUndo - Whether it was an undo.
 * @param count - How many objects it did not bring back, at least 1.
 * @returns The sentence.
 */
function omittedObjectsNotice(isUndo: boolean, count: number): string {
  const what = count === 1 ? '1 object because its' : `${String(count)} objects because their`;
  return `${isUndo ? 'Undo' : 'Redo'} could not bring back ${what} stored values are out of range.`;
}

/**
 * Runs undo or redo on the person's history. One click undoes or redoes at most one step; a
 * step whose changes were all overwritten since (by someone else, by the same person in another
 * tab, or by the product's own writes), so that it can change nothing any more, is used up with
 * nothing changed, and the shell is told, so the click does not look ignored. A step
 * that would have written back a value the relay refuses (a size or coordinate a peer left out
 * of range) applies without it, and the shell is told that instead, naming how many
 * whole objects it could not bring back when it left any out. A step used up because another
 * person changed it since comes with what they changed (`lastProtection`), which the shell
 * outlines while the notice shows (`noticeOf`). Main thread.
 *
 * @param history - The person's undo history.
 * @param command - Undo or redo.
 * @param onNotice - Receives the sentence the shell shows when a step changed nothing, or left
 *   part of itself out, and why when another person's change kept it.
 */
export function runHistoryCommand(
  history: EditHistory,
  command: HistoryCommand,
  onNotice?: NoticeSink,
): void {
  const isUndo = command === 'undo';
  // A step written in parts is restored a part per task, the store held meanwhile.
  if (history.startRestore !== undefined) {
    history.startRestore(command, { yieldToBrowser })?.then(
      (report) => {
        showRestored(isUndo, report, onNotice);
      },
      (error: unknown) => {
        stoppedOrFault(error, { onNotice: (message) => onNotice?.(message) });
      },
    );
    return;
  }
  const hasStep = isUndo ? history.canUndo() : history.canRedo();
  const isChanged = isUndo ? history.undo() : history.redo();
  showRestored(
    isUndo,
    {
      isChanged: !hasStep || isChanged,
      omission: history.lastOmission?.(),
      omittedObjects: history.lastOmittedObjects?.() ?? 0,
      protection: history.lastProtection?.(),
    },
    onNotice,
  );
}

/**
 * Tells the shell what an undo or redo left out or could not change.
 *
 * @param isUndo - Whether it was an undo.
 * @param restored - What it did.
 * @param onNotice - Receives the sentence.
 */
function showRestored(
  isUndo: boolean,
  restored: Pick<RestoreReport, 'isChanged' | 'omission' | 'omittedObjects' | 'protection'>,
  onNotice: NoticeSink | undefined,
): void {
  if (restored.omittedObjects > 0) {
    onNotice?.(omittedObjectsNotice(isUndo, restored.omittedObjects));
  } else if (restored.omission === 'out-of-range') {
    const verb = isUndo ? 'undone' : 'redone';
    onNotice?.(`Part of this could not be ${verb}: it holds a value out of range.`);
  } else if (!restored.isChanged) {
    const message = `Nothing to ${isUndo ? 'undo' : 'redo'} here: this has changed since.`;
    const { protection } = restored;
    onNotice?.(message, protection === undefined ? undefined : { isUndo, protection });
  }
}

/**
 * Writes board objects into the document as they are (ids, z keys and stamps kept), in one
 * transaction with the system origin, as a document load: no user's undo history includes it.
 * The scene and the hit-test index follow the change set like any other. For the benchmark
 * harness, which loads its synthetic boards into the document the select tool edits.
 *
 * @param store - The document.
 * @param objects - The objects, parents before children; each validated by the store.
 * @throws {Error} When the store refuses an object (the transaction then writes nothing).
 */
export function loadBoardObjects(store: DocumentStore, objects: readonly BoardObject[]): void {
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
}
