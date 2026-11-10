import {
  moveObjectsCommand,
  patchAutoLayoutCommand,
  placeObjectsCommand,
  resizeObjectsCommand,
  rotateObjectsCommand,
  runCommand,
  setAutoLayoutCommand,
  setLayoutChildCommand,
  setStyleCommand,
  type CommandError,
  type DocumentStore,
} from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';
import type { SelectController, ToolId } from '@canvas/tools';

import { planLayoutChange, type LayoutField } from '../panels/layout-box.js';
import type { CanvasAction, ComponentAction, StyleChange } from '../state/shell-action.js';
import type { ToolStyle } from '../state/tool-style.js';

import type { BoardView, ObjectSearch } from './board-view.js';
import { canvasActionEntry, type CanvasInputContext } from './canvas-input-checks.js';
import { DeletionConfirmations } from './deletion-confirmations.js';
import { DocumentBoardView } from './document-board-view.js';
import type { DocumentInputQueue } from './document-input-queue.js';
import { isObjectEdit, runObjectEdit, type PanelAction } from './panel-actions.js';
import { runColorTokenAction } from './run-color-token-action.js';
import { runComponentAction } from './run-component-action.js';
import { toggleSelectionLock, type SelectionEditTarget } from './selection-arrange.js';

/** What an `autoLayout` canvas action changes. */
type AutoLayoutChange = Extract<CanvasAction, { readonly type: 'autoLayout' }>['change'];

/** What {@link DocumentPanels} reads of the select tool. */
export type PanelSelectTool = Pick<
  SelectController,
  'selection' | 'select' | 'isGesturing' | 'enteredGroupId' | 'source'
>;

/** What {@link DocumentPanels} edits: the page shown, and the whole board and its pages. */
export interface PanelEditTarget extends SelectionEditTarget {
  /** The whole board when `store` shows one page; `store` when absent. */
  readonly definitions?: DocumentStore | undefined;
  /**
   * Shows the page an object is on (going to a main); nothing switches when absent.
   *
   * @param id - The object.
   */
  readonly showPageOf?: ((id: ObjectId) => void) | undefined;
  /**
   * The person's input queue, and where its checks read the board: each panel action
   * runs through it, so none writes while a stepped run holds the store. Run at once when absent.
   */
  readonly input?:
    { readonly queue: DocumentInputQueue; readonly context: CanvasInputContext } | undefined;
  /**
   * The hit index, which answers the board view's `objectsIn`; the view finds
   * nothing when absent.
   */
  readonly hits?: ObjectSearch | undefined;
}

/**
 * The engine's document side as the shell's panels and creation tools see it: the
 * board view the panels read, the style panel's restyles, the inspector's layout
 * fields and the layers panel's lock-by-id, each one command and so one undo step, the inspector's
 * component commands, the deletions waiting for the person's answer, and the creation
 * tools' styles, which the shell sets and a tool reads when it makes an object. Main thread.
 */
export class DocumentPanels {
  /** The board as the panels see it. */
  readonly boardView: DocumentBoardView;
  /** The deletions waiting for the person's answer (ruling 6), shown on the board view. */
  readonly deletions = new DeletionConfirmations();
  private readonly edits: PanelEditTarget;
  private readonly selectTool: () => PanelSelectTool;
  private readonly onCommandRefused: (errors: readonly CommandError[]) => void;
  private readonly toolStyles = new Map<ToolId, ToolStyle>();
  /** Panel actions that arrived during a press or drag, to run once it ends. */
  private held: (PanelAction | ComponentAction)[] = [];

  /**
   * Starts following the document. The select tool is reached through a function and read only
   * when told the selection changed, so it may be made after this.
   *
   * @param edits - The document, origin and environment its commands run with, the whole board
   *   and how to show a page.
   * @param selectTool - The select tool: its selection, which the board view reports and a
   *   panel changes, and whether a drag is under way (the panels' commands wait until it ends).
   * @param onCommandRefused - Receives the errors of a command the document refused.
   */
  constructor(
    edits: PanelEditTarget,
    selectTool: () => PanelSelectTool,
    onCommandRefused: (errors: readonly CommandError[]) => void,
  ) {
    this.edits = edits;
    this.selectTool = selectTool;
    this.onCommandRefused = onCommandRefused;
    const selection = {
      ids: () => selectTool().selection.ids,
      select: (ids: readonly ObjectId[]) => {
        selectTool().select(ids);
      },
      enteredGroupId: () => selectTool().enteredGroupId,
      shown: (id: ObjectId) => selectTool().source.get(id),
    };
    const { definitions } = edits;
    this.boardView = new DocumentBoardView(edits.store, selection, {
      definitions,
      deletions: this.deletions,
      search: edits.hits,
    });
  }

  /**
   * The board view, typed as the shell reads it.
   *
   * @returns The view.
   */
  get board(): BoardView {
    return this.boardView;
  }

  /**
   * Runs a panel's canvas action: a restyle (`restyle`), a layout field (`relayout`), a layers
   * row's lock (`toggleLock`), a layers drop (`place`) or a colour token change. One that arrives during a press or
   * drag on the board is held and runs when it ends (`runHeld`), not dropped: a colour
   * input or a number field commits on its native `change`, which fires when it loses focus,
   * and a press on the board is what takes the focus. It still acts on the objects it names,
   * whatever the press selected.
   *
   * @param action - The action.
   */
  runAction(action: PanelAction): void {
    if (this.selectTool().isGesturing) this.held.push(action);
    else this.enqueue(action);
  }

  /**
   * Runs the panel actions held during a press or drag, in the order they came, once no press
   * or drag is under way; nothing while one still is. The engine's document side calls it after
   * each pointer input and canvas action, and after a tool change, which can end a drag.
   */
  runHeld(): void {
    if (this.held.length === 0 || this.selectTool().isGesturing) return;
    const held = this.held;
    this.held = [];
    for (const action of held) this.enqueue(action);
  }

  /** Drops the held panel actions unrun: the person can no longer edit. */
  dropHeld(): void {
    this.held = [];
  }

  /**
   * Runs a panel action through the input queue: at once while no run holds the store
   * and nothing waits, or inside the canvas action being run; else once idle, checked again.
   *
   * @param action - The action.
   * @param work - What runs it.
   */
  private enqueue(
    action: PanelAction | ComponentAction,
    work = (): void => {
      this.act(action);
    },
  ): void {
    const { input } = this.edits;
    if (input === undefined) work();
    else input.queue.run(canvasActionEntry(action, input.context, work));
  }

  /**
   * Runs one panel action now.
   *
   * @param action - The action.
   */
  private act(action: PanelAction | ComponentAction): void {
    if (action.type === 'component') this.runComponent(action);
    else if (action.type === 'style') this.restyle(action.changes);
    else if (action.type === 'layout') this.relayout(action.ids, action.field, action.value);
    else if (action.type === 'placeLayers') this.place(action);
    else if (action.type === 'colorToken') this.runColorToken(action);
    else if (action.type === 'autoLayout') this.changeAutoLayout(action.ids, action.change);
    else if (isObjectEdit(action)) runObjectEdit(this.edits, action, this.onCommandRefused);
    else this.toggleLock(action.ids);
  }

  /**
   * Places objects from the layers panel as one `placeObjects` command, so one
   * transaction and one undo step: directly below a sibling or on top of a frame, group or the
   * root, where they are on the board. A refusal (a locked or deleted target, a cycle a
   * collaborator's move made meanwhile) writes nothing and is reported. Not mid-drag (`runAction` holds it).
   *
   * @param placing - The objects, their new parent and the sibling they go below.
   */
  place(placing: Extract<CanvasAction, { readonly type: 'placeLayers' }>): void {
    if (placing.ids.length === 0 || this.selectTool().isGesturing) return;
    const { store, origin, environment } = this.edits;
    // The command's input is JSON-shaped (agents send it too), so it takes a plain array.
    const input = {
      ids: [...placing.ids],
      parentId: placing.parentId,
      ...(placing.belowId === undefined ? {} : { belowId: placing.belowId }),
    };
    const outcome = runCommand(store, origin, placeObjectsCommand, input, environment);
    if (outcome.status === 'rejected') this.onCommandRefused(outcome.errors);
  }

  /**
   * Runs a Board colours command (`runColorTokenAction`) on the whole board's token
   * table: one command and one undo step. Not mid-drag (`runAction` holds it).
   *
   * @param action - The command.
   */
  private runColorToken(action: Extract<PanelAction, { readonly type: 'colorToken' }>): void {
    const { onCommandRefused } = this;
    runColorTokenAction({ ...this.edits, onCommandRefused }, action);
  }

  /**
   * Changes frames' and mains' auto-layout, or how boxes sit in one, from the inspector:
   * one `setAutoLayout`, `patchAutoLayout` or `setLayoutChild` command, so one
   * transaction and one undo step, which lays the containers out in it. A refusal (a locked or
   * deleted object, a type that does not take it) writes nothing and is reported. Not mid-drag
   * (`runAction` holds it), and nothing for no objects.
   *
   * @param ids - The containers, or the boxes for `child`.
   * @param change - What changes.
   */
  changeAutoLayout(ids: readonly ObjectId[], change: AutoLayoutChange): void {
    if (ids.length === 0 || this.selectTool().isGesturing) return;
    const { store, origin, environment } = this.edits;
    // The commands' inputs are JSON-shaped (agents send them too), so they take plain arrays.
    const targets = [...ids];
    const outcome =
      change.kind === 'set'
        ? runCommand(
            store,
            origin,
            setAutoLayoutCommand,
            { ids: targets, autoLayout: change.autoLayout },
            environment,
          )
        : change.kind === 'patch'
          ? runCommand(
              store,
              origin,
              patchAutoLayoutCommand,
              { ids: targets, patch: change.patch },
              environment,
            )
          : runCommand(
              store,
              origin,
              setLayoutChildCommand,
              { ids: targets, layoutChild: change.layoutChild },
              environment,
            );
    if (outcome.status === 'rejected') this.onCommandRefused(outcome.errors);
  }

  /**
   * Runs the inspector's command on a main or an instance (`runComponentAction`): one
   * command and one undo step, or going to a main. A command that arrives during a press or drag
   * on the board is held like `runAction`'s (a text field commits on blur, which the
   * press takes); going to a main mid-drag does nothing.
   *
   * @param action - The command.
   * @returns False when the camera should zoom to the selection (going to a main); else true.
   */
  runComponentAction(action: ComponentAction): boolean {
    if (!this.selectTool().isGesturing) {
      let isTaken = true;
      this.enqueue(action, () => {
        isTaken = this.runComponent(action);
      });
      return isTaken;
    }
    if (action.command !== 'goToMain') this.held.push(action);
    return true;
  }

  /**
   * Runs one component command now.
   *
   * @param action - The command.
   * @returns False when the camera should zoom to the selection; else true.
   */
  private runComponent(action: ComponentAction): boolean {
    const selectTool = this.selectTool();
    const select = (ids: readonly ObjectId[]): void => {
      selectTool.select(ids);
    };
    const onCommandRefused = this.onCommandRefused;
    return runComponentAction({ ...this.edits, select, onCommandRefused }, action);
  }

  /**
   * Restyles objects as one `setStyle` command, so one transaction and one undo step; a
   * refusal (an object deleted or locked meanwhile, a field its type does not take) writes
   * nothing and is reported. Nothing runs mid-drag (`runAction` holds it) or for no changes.
   *
   * @param changes - One entry per object.
   */
  restyle(changes: readonly StyleChange[]): void {
    if (changes.length === 0 || this.selectTool().isGesturing) return;
    const { store, origin, environment } = this.edits;
    // The command's input is JSON-shaped (agents send it too), so it takes a plain array.
    const input = { changes: [...changes] };
    const outcome = runCommand(store, origin, setStyleCommand, input, environment);
    if (outcome.status === 'rejected') this.onCommandRefused(outcome.errors);
  }

  /**
   * Sets one layout field of objects from the inspector's layout section, as the
   * existing `moveObjects`, `resizeObjects` or `rotateObjects` command (`planLayoutChange`):
   * one transaction and one undo step. A refusal (a locked object, a size a group cannot take)
   * writes nothing and is reported. Nothing runs mid-drag (`runAction` holds it) or when nothing would change.
   *
   * @param ids - The objects.
   * @param field - The field.
   * @param value - The value committed.
   */
  relayout(ids: readonly ObjectId[], field: LayoutField, value: number): void {
    if (this.selectTool().isGesturing || !Number.isFinite(value)) return;
    const { store, origin, environment } = this.edits;
    const objects = ids.flatMap((id): BoardObject[] => {
      const object = store.get(id);
      return object === undefined ? [] : [object];
    });
    const plan = planLayoutChange(store, objects, field, value);
    if (plan === undefined) return;
    const outcome =
      plan.kind === 'move'
        ? runCommand(store, origin, moveObjectsCommand, plan.input, environment)
        : plan.kind === 'resize'
          ? runCommand(store, origin, resizeObjectsCommand, plan.input, environment)
          : runCommand(store, origin, rotateObjectsCommand, plan.input, environment);
    if (outcome.status === 'rejected') this.onCommandRefused(outcome.errors);
  }

  /**
   * Locks or unlocks given objects (a layers panel row's lock) as one `setLocked` command,
   * leaving the selection as it is: locked as a whole they unlock, else they lock. Not mid-drag (`runAction` holds it).
   *
   * @param ids - The objects.
   */
  toggleLock(ids: readonly ObjectId[]): void {
    if (!this.selectTool().isGesturing) toggleSelectionLock(this.edits, ids);
  }

  /**
   * Sets the style a creation tool gives new objects: its registered defaults with the
   * person's choices from the style panel over them (`resolveToolStyle`), replacing what was
   * set before.
   *
   * @param tool - The creation tool.
   * @param style - Its style.
   */
  setToolStyle(tool: ToolId, style: ToolStyle): void {
    this.toolStyles.set(tool, style);
  }

  /**
   * The style a creation tool gives new objects, for the tool's mode to read when it creates
   * one (text, sticky, pen, shape, line).
   *
   * @param tool - The creation tool.
   * @returns Its style; empty (the tool's own defaults) until the shell sets one.
   */
  toolStyle(tool: ToolId): ToolStyle {
    return this.toolStyles.get(tool) ?? {};
  }

  /** Stops following the document; a deletion still waiting is dropped. */
  destroy(): void {
    this.deletions.destroy();
    this.boardView.destroy();
  }
}

/**
 * What a document side does with a refused command or a notice when nobody listens: nothing.
 * The shell passes `onCommandRefused` and `onNotice`; tests and the benchmark harness may not.
 */
export function ignoreReport(): void {
  // Nothing to tell.
}
