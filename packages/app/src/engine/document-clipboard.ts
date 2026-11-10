import {
  createInstanceCommand,
  createObjectsCommand,
  deleteObjectsCommand,
  runCommand,
  type BoardReader,
  type CommandEnvironment,
  type CommandError,
  type CreateObjectsResult,
  type DocumentStore,
  type NewObject,
  type RunReport,
  type RunStoppedError,
  type TransactionOrigin,
} from '@canvas/document';
import { copySelection, countCopied } from '@canvas/document';
import { planDuplicate } from '@canvas/document';
import { inParentFrame } from '@canvas/document';
import { isStoreRunning } from '@canvas/document';
import {
  objectToBoardTransform,
  type Board,
  type BoardObject,
  type ObjectId,
  type Point,
} from '@canvas/schema';
import type { SelectController } from '@canvas/tools';

import { clipboardColorsOf } from '../clipboard/clipboard-colors.js';
import type { ClipboardColors } from '../clipboard/clipboard-flavours.js';
import { imageAssetsOf } from '../clipboard/linked-paste.js';
import type { PasteTarget } from '../clipboard/paste-handlers.js';
import { BUSY_NOTICE } from '../notices/busy-notices.js';
import { refusalNotice } from '../notices/refusal-notice.js';

import { componentDeletionOf } from './component-deletion.js';
import {
  createRefusedNotice,
  createStoppedNotice,
  duplicateTooLargeNotice,
  MAX_DUPLICATE_OBJECTS,
  type CreateKind,
} from './create-notices.js';
import type { DeletionConfirmations } from './deletion-confirmations.js';
import { linkCardWritesOf } from './link-card-writes.js';
import { pasteSectionOf } from './paste-section.js';
import { noticeHandlers, runStepped, stagingFor, STEPPED_MAX_WRITES } from './run-stepped.js';

/** What {@link DocumentClipboard} works on: the engine document's store, user and selection. */
export interface DocumentClipboardOptions {
  /** The document. */
  readonly store: DocumentStore;
  /** Who cuts, pastes and duplicates are attributed to. */
  readonly origin: TransactionOrigin;
  /** The command clock and id generator. */
  readonly environment: CommandEnvironment;
  /**
   * The select tool: what is selected, whether a drag is under way, the group entered with a
   * double-click, and selecting.
   */
  readonly controller: Pick<
    SelectController,
    'selection' | 'isGesturing' | 'enteredGroupId' | 'select'
  >;
  /** Shows the person a clipboard notice's message; no-op if absent. */
  readonly onNotice?: (message: string) => void;
  /**
   * Whether the person may edit the board now, read at the moment objects would be
   * created: an image picked, dropped or pasted that finishes preparing after they were made a
   * viewer creates nothing (and so uploads nothing). Always when absent.
   */
  readonly canEdit?: () => boolean;
  /**
   * Where a cut that would delete a main with instances waits for the person's answer (
   * ruling 6): the copy is written, and the delete runs once they confirm. At once when absent.
   */
  readonly deletions?: DeletionConfirmations;
  /**
   * The whole board as the person writes to it from the page shown (`PageBoardStore`), where
   * cuts, pastes and duplicates are written: a cut main's instances and a pasted instance's main
   * may be on other pages. `store` when absent.
   */
  readonly board?: DocumentStore;
}

/** A cut of the selection, prepared: the copy and what to delete, or why there is none. */
export type DocumentCut =
  | {
      /** Nothing selected can be copied, or a drag is under way. */
      readonly kind: 'empty';
    }
  | {
      /** The selection holds a locked object. */
      readonly kind: 'refused';
      /** Why, a sentence for the person. */
      readonly message: string;
    }
  | {
      /** The cut can go ahead. */
      readonly kind: 'ready';
      /** The copy (`copySelection`). */
      readonly copied: Board;
      /** Deletes the copied objects still on the board and unlocked, as one delete command. */
      remove(): void;
    };

/** The message of a cut refused for a locked object (the router's `cut-locked`). */
const LOCKED_CUT_MESSAGE =
  'The selection holds a locked object, so nothing was cut. Unlock it first.';

/** The message of a paste that arrives during a drag, which creates nothing. */
const MID_DRAG_MESSAGE = 'Finish the drag, then paste.';

/**
 * The most objects a create writes as one part of a stepped run (an object written costs two
 * planned writes): a create of no more is run at once, in the calling task.
 */
const ONE_PART_OBJECTS = STEPPED_MAX_WRITES / 2;

/**
 * The engine document's clipboard side: the selection as a board of its own, cut, the
 * paste location, and duplicate. Everything a paste or duplicate creates is one `createObjects`
 * command of the local user (one undo step), and the new top-level objects become the selection.
 * Copies keep `locked` (a pasted locked object stays locked, and a click still selects it). Main
 * thread.
 */
export class DocumentClipboard {
  private readonly options: DocumentClipboardOptions;

  /**
   * Works on the engine document's store and selection.
   *
   * @param options - The store, origin, environment and select tool.
   */
  constructor(options: DocumentClipboardOptions) {
    this.options = options;
  }

  /**
   * The selection as a board of its own: the selected objects with their descendants, the roots
   * at the board root where they are (`copySelection`).
   *
   * @returns The copy, or `undefined` when nothing selected can be copied.
   */
  copySelection(): Board | undefined {
    return copySelection(this.options.store.read(), this.options.controller.selection.ids);
  }

  /**
   * How a copy's text colours resolve in its HTML: always light (`clipboardColorsOf`).
   *
   * @returns The tokens and the mode of an object's text.
   */
  clipboardColors(): ClipboardColors {
    return clipboardColorsOf((this.options.board ?? this.options.store).readTokens());
  }

  /**
   * Prepares a cut: the copy, and a delete of the copied objects (their ids taken now) to run
   * once the copy is written. Refused when a selected object is locked, since the delete key
   * leaves locked objects alone and a cut that copied one without deleting it would duplicate it
   * on paste. Nothing during a drag. The delete asks `canEdit` when it runs: a person
   * who cannot edit, or was made a viewer since the cut began, copies and removes nothing. A cut
   * of a main with instances asks the person before it deletes (ruling 6).
   *
   * @returns The prepared cut.
   */
  prepareCut(): DocumentCut {
    const { store, origin, environment, controller, canEdit } = this.options;
    const board = this.options.board ?? store;
    if (controller.isGesturing) return { kind: 'empty' };
    const { ids } = controller.selection;
    if (ids.some((id) => store.get(id)?.locked === true)) {
      return { kind: 'refused', message: LOCKED_CUT_MESSAGE };
    }
    const copied = copySelection(store.read(), ids);
    if (copied === undefined) return { kind: 'empty' };
    const copiedIds = [...copied.objects.values()]
      .filter(({ parentId }) => parentId === null)
      .map(({ id }) => id);
    const remove = (): void => {
      // The write may have awaited: leave what is gone, and what someone locked meanwhile.
      if (canEdit?.() === false || this.refusesBusy()) return;
      const present = copiedIds.filter((id) => store.get(id)?.locked === false);
      if (present.length === 0) return;
      // A part per task, the store held meanwhile; a refusal is told.
      const notify = (message: string): void => this.options.onNotice?.(message);
      const handlers = noticeHandlers(notify);
      const input = { ids: present };
      // Counted with their descendants, which the delete takes with it.
      const staging = stagingFor(copied.objects.size);
      runStepped(board, origin, deleteObjectsCommand, input, environment, handlers, staging);
    };
    const { deletions } = this.options;
    const deletion = deletions && componentDeletionOf(board, copiedIds);
    return {
      kind: 'ready',
      copied,
      remove: deletion === undefined ? remove : () => deletions?.ask(deletion, remove),
    };
  }

  /**
   * Where a paste goes: pasted objects are created on top of the group entered with a
   * double-click while one is, else in the section under the pointer (item 9),
   * else at the board root, where the plan put them on the board;
   * notices go to `onNotice` as their message. A paste during a drag creates nothing and asks the
   * person to finish the drag first.
   *
   * @param pointer - The pointer on the board, or `undefined` while it is off the canvas.
   * @param viewCentre - The board point at the centre of the view.
   * @returns The target.
   */
  pasteTarget(pointer: Point | undefined, viewCentre: Point): PasteTarget {
    const notify = (message: string): void => {
      this.options.onNotice?.(message);
    };
    const { store, origin, environment } = this.options;
    return {
      pointer,
      viewCentre,
      createObjects: (objects, onCreated) => {
        if (this.options.controller.isGesturing) {
          notify(MID_DRAG_MESSAGE);
          return false;
        }
        // In the entered group, else in the section under the pointer (item 9).
        const parent = this.enteredGroup() ?? pasteSectionOf(this.options.store, pointer);
        if (parent === undefined) return this.createObjects(objects, null, 'paste', onCreated);
        const toBoard = objectToBoardTransform(this.options.store.read(), parent);
        const placed = inParentFrame(objects, toBoard);
        return this.createObjects(placed, parent.id, 'paste', onCreated);
      },
      notify,
      ...linkCardWritesOf({ store, origin, environment }),
      shownImagesAmong: (assetIds) => {
        const wanted = new Set(assetIds);
        const shown = imageAssetsOf(this.options.store.read());
        return new Set(shown.filter((asset) => wanted.has(asset)));
      },
    };
  }

  /**
   * Duplicates the selection (mod+d; `planDuplicate`), without the clipboard. A selection
   * that would copy more than `MAX_DUPLICATE_OBJECTS` objects is refused with a notice before
   * anything is copied.
   */
  duplicateSelection(): void {
    const { store, controller } = this.options;
    const board = store.read();
    const count = countCopied(board, controller.selection.ids);
    if (count > MAX_DUPLICATE_OBJECTS) {
      this.options.onNotice?.(duplicateTooLargeNotice(count));
      return;
    }
    const plan = planDuplicate(board, controller.selection.ids);
    if (plan !== undefined) this.createObjects(plan.objects, plan.parentId, 'duplicate');
  }

  /**
   * Whether the person may place objects now: what a drop on the canvas is offered.
   *
   * @returns False once they cannot edit.
   */
  canPlace(): boolean {
    return this.options.canEdit?.() !== false;
  }

  /**
   * Places an instance of a main centred on a point, at the board root of the page shown, and
   * selects it (the components panel's Place and a row dropped on the canvas, ruling 3):
   * one `createInstance` over the whole board, where the main may be on another page. Not
   * mid-drag, not once the person cannot edit; a refusal is told as a notice.
   *
   * @param mainId - The main.
   * @param at - The instance's centre, world units.
   */
  placeInstance(mainId: ObjectId, at: Point): void {
    const { store, origin, environment, controller, canEdit } = this.options;
    if (canEdit?.() === false || controller.isGesturing || this.refusesBusy()) return;
    const board = this.options.board ?? store;
    const main = board.get(mainId);
    if (main?.type !== 'component') return;
    const input = { componentId: mainId, x: at.x - main.width / 2, y: at.y - main.height / 2 };
    const outcome = runCommand(board, origin, createInstanceCommand, input, environment);
    if (outcome.status === 'applied') controller.select([outcome.result.instanceId]);
    else this.options.onNotice?.(refusalNotice(outcome.errors));
  }

  /**
   * Whether a write is refused because a stepped run holds the store: the person is
   * told, and can try again once it ends.
   *
   * @returns True when busy.
   */
  private refusesBusy(): boolean {
    if (!isStoreRunning(this.options.store)) return false;
    this.options.onNotice?.(BUSY_NOTICE);
    return true;
  }

  /**
   * The group entered with a double-click, while it is still a group on the board.
   *
   * @returns The group, or `undefined` at the board's top level.
   */
  private enteredGroup(): BoardObject | undefined {
    const { enteredGroupId } = this.options.controller;
    const group = enteredGroupId === null ? undefined : this.options.store.get(enteredGroupId);
    return group?.type === 'group' ? group : undefined;
  }

  /**
   * Creates objects as one `createObjects` command, and selects the new top-level objects once it
   * is done: at once when they fit one part, else a part per task (`runStepped`, planned in
   * stages); not mid-drag, and not
   * once the person cannot edit: the one place every paste, drop, picked image and
   * duplicate is written. A refusal or a stop is told with its object counts.
   *
   * @param objects - The objects as `createObjects` lists them.
   * @param parentId - Where the top-level objects go; the board root when `null`.
   * @param kind - A paste or a duplicate, for the notices.
   * @param onCreated - Given the new ids in list order once every part is in; never after a
   *   refusal or a stop.
   * @returns False when refused at once: mid-drag, read-only, busy or nothing to create.
   */
  private createObjects(
    objects: readonly NewObject[],
    parentId: ObjectId | null,
    kind: CreateKind,
    onCreated?: (ids: readonly ObjectId[]) => void,
  ): boolean {
    const { store, origin, environment, controller, canEdit } = this.options;
    if (canEdit?.() === false || controller.isGesturing || objects.length === 0) return false;
    if (this.refusesBusy()) return false;
    // Over the whole board, where a pasted instance's main may be.
    const board = this.options.board ?? store;
    // The page a copy came from is not where it lands: new objects at the root go on the page
    // shown, named in the input so the store places them as planned.
    const reader: BoardReader = board;
    const pageId = parentId === null ? reader.defaultPageId?.() : undefined;
    const input = {
      objects: objects.map(withoutPage),
      parentId,
      ...(pageId === undefined ? {} : { pageId }),
    };
    const notify = (message: string): void => {
      this.options.onNotice?.(message);
    };
    const done = (ids: readonly ObjectId[]): void => {
      controller.select(ids.filter((id, index) => objects[index]?.parentId === null));
      onCreated?.(ids);
    };
    if (objects.length <= ONE_PART_OBJECTS) {
      // As one part it would be written in this task anyway: at once, as it always was.
      const outcome = runCommand(board, origin, createObjectsCommand, input, environment);
      if (outcome.status === 'applied') done(outcome.result.ids);
      else notify(createRefusedNotice(kind, objects.length, outcome.errors));
      return true;
    }
    const handlers = {
      onRefused: (errors: readonly CommandError[]) => {
        notify(createRefusedNotice(kind, objects.length, errors));
      },
      onDone: (report: RunReport<unknown>) => {
        done((report.result as CreateObjectsResult).ids);
      },
      onNotice: notify,
      onStopped: (error: RunStoppedError) => {
        notify(createStoppedNotice(kind, objects.length, error));
      },
    };
    runStepped(board, origin, createObjectsCommand, input, environment, handlers, {
      isPlanStaged: true,
    });
    return true;
  }
}

/**
 * An object to create with the page it was copied from left out.
 *
 * @param object - The object as `createObjects` lists it.
 * @returns A copy without `pageId`.
 */
function withoutPage(object: NewObject): NewObject {
  const copy: Partial<NewObject> = { ...object };
  delete copy.pageId;
  return copy as NewObject;
}
