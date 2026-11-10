import {
  createInstanceCommand,
  detachInstanceCommand,
  renameObjectCommand,
  resetInstanceOverridesCommand,
  resizeObjectsCommand,
  runCommand,
  setInstanceOverrideCommand,
  setSwapOptionsCommand,
  type CommandError,
  type CommandOutcome,
  type DocumentStore,
} from '@canvas/document';
import { objectToBoardTransform, type ObjectId } from '@canvas/schema';

import type { ComponentAction } from '../state/shell-action.js';

import { runVariantAction } from './run-variant-action.js';
import type { SelectionEditTarget } from './selection-arrange.js';

/** How far to the right of its main "Place instance" puts an instance, world units (ruling 4). */
export const PLACED_INSTANCE_GAP = 40;

/** What {@link runComponentAction} works on. */
export interface ComponentActionContext extends SelectionEditTarget {
  /**
   * The whole board, where an instance's commands run: its main and the main's content may be
   * on another page than the one `store` shows. `store` when absent.
   */
  readonly definitions?: DocumentStore | undefined;
  /**
   * Shows the page an object is on, if it is not the page shown; nothing switches when absent.
   *
   * @param id - The object.
   */
  readonly showPageOf?: ((id: ObjectId) => void) | undefined;
  /**
   * Selects exactly these objects, as a click would.
   *
   * @param ids - The objects.
   */
  select(ids: readonly ObjectId[]): void;
  /** Receives the errors of a command the document refused. */
  readonly onCommandRefused: (errors: readonly CommandError[]) => void;
}

/**
 * Places an instance of a main to its right, `PLACED_INSTANCE_GAP` apart, top edges level, at
 * the board root of the page shown (the main's: it is selected there), and selects it.
 *
 * @param context - The document and the select tool.
 * @param mainId - The main.
 * @returns The command's outcome, or undefined when the main is not on the page shown.
 */
function placeInstance(
  context: ComponentActionContext,
  mainId: ObjectId,
): CommandOutcome<unknown> | undefined {
  const { store, origin, environment } = context;
  const main = store.get(mainId);
  if (main?.type !== 'component') return undefined;
  const world = objectToBoardTransform(store.read(), main);
  const input = { componentId: mainId, x: world.x + main.width + PLACED_INSTANCE_GAP, y: world.y };
  const outcome = runCommand(store, origin, createInstanceCommand, input, environment);
  if (outcome.status === 'applied') context.select([outcome.result.instanceId]);
  return outcome;
}

/**
 * Runs the inspector's command on a main or an instance (rulings 4 and 5), each one
 * document command and so one undo step: an override, a reset, a detach, a slot's swap options
 * and the variant commands over the whole board (`definitions`); placing an
 * instance and renaming over the page shown. Going to a main, or a search result, shows
 * its page and selects it; the camera zooms. A refusal writes nothing and is reported. Main thread.
 *
 * @param context - The document, the select tool, the pages and where refusals go.
 * @param action - The command.
 * @returns False for going to a main or a result, whose zoom to the selection the camera runs,
 *   and for placing at a point, the mount's clipboard side's; else true.
 */
export function runComponentAction(
  context: ComponentActionContext,
  action: ComponentAction,
): boolean {
  const { store, origin, environment } = context;
  const board = context.definitions ?? store;
  const { id } = action;
  let outcome: CommandOutcome<unknown> | undefined;
  switch (action.command) {
    case 'setOverride': {
      const input = { id, path: action.path, override: action.override };
      outcome = runCommand(board, origin, setInstanceOverrideCommand, input, environment);
      break;
    }
    case 'resetOverrides': {
      const input = {
        id,
        ...(action.path === undefined ? {} : { path: action.path }),
        ...(action.fields === undefined ? {} : { fields: [...action.fields] }),
      };
      outcome = runCommand(board, origin, resetInstanceOverridesCommand, input, environment);
      break;
    }
    case 'detach':
      outcome = runCommand(board, origin, detachInstanceCommand, { id }, environment);
      break;
    case 'setScale': {
      const input = { resizes: [{ id, scale: action.scale }] };
      outcome = runCommand(board, origin, resizeObjectsCommand, input, environment);
      break;
    }
    case 'setVariant':
    case 'setVariantAxes':
    case 'setPreset':
    case 'resetPreset':
      outcome = runVariantAction(board, context, action);
      break;
    case 'placeInstance':
      outcome = placeInstance(context, id);
      break;
    case 'rename':
      outcome = runCommand(
        store,
        origin,
        renameObjectCommand,
        { id, name: action.name },
        environment,
      );
      break;
    case 'setSwapOptions': {
      const input = { id, options: action.options === null ? null : [...action.options] };
      outcome = runCommand(board, origin, setSwapOptionsCommand, input, environment);
      break;
    }
    case 'placeInstanceAt':
      // The mount's clipboard side's, which knows the view (`EngineClipboard`).
      return false;
    case 'previewPreset':
      // The engine document's tool previews', which write nothing (`EngineDocument`).
      return false;
    case 'goToMain':
      context.showPageOf?.(id);
      context.select([id]);
      return false;
  }
  if (outcome?.status === 'rejected') context.onCommandRefused(outcome.errors);
  return true;
}
