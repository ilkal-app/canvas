import {
  bringForwardCommand,
  bringToFrontCommand,
  runCommand,
  sendBackwardCommand,
  sendToBackCommand,
  setLockedCommand,
  type CommandEnvironment,
  type DocumentStore,
  type ReorderCommand,
  type TransactionOrigin,
} from '@canvas/document';
import type { ObjectId } from '@canvas/schema';
import {
  carriedLabelsOf,
  lockToggleOf,
  orderTargetOf,
  type OrderTarget,
  type SelectionSource,
} from '@canvas/tools';

import type { ArrangeCommand } from '../state/shell-action.js';

/** The arrange commands that change the z-order. */
export type OrderCommand = Extract<
  ArrangeCommand,
  'bringToFront' | 'sendToBack' | 'bringForward' | 'sendBackward'
>;

/** The document command behind each order command. */
const ORDER_COMMANDS: Readonly<Record<OrderCommand, ReorderCommand>> = {
  bringToFront: bringToFrontCommand,
  sendToBack: sendToBackCommand,
  bringForward: bringForwardCommand,
  sendBackward: sendBackwardCommand,
};

/** What a selection edit runs its command against. */
export interface SelectionEditTarget {
  /** The document. */
  readonly store: DocumentStore;
  /** Who the command is attributed to. */
  readonly origin: TransactionOrigin;
  /** The command clock and id generator. */
  readonly environment: CommandEnvironment;
}

/**
 * The document's objects as the selection rules read them.
 *
 * @param store - The document.
 * @returns Its objects by id.
 */
function sourceOf(store: DocumentStore): Pick<SelectionSource, 'get'> {
  return { get: (id) => store.get(id) };
}

/** The order commands that raise, which carry the labels on a selected sticky note with it. */
const RAISING_COMMANDS: ReadonlySet<OrderCommand> = new Set(['bringToFront', 'bringForward']);

/**
 * Runs an order command on a selection: on its largest
 * same-parent subset (`orderTargetOf`), since the order commands take the children of one
 * parent, as one command, so one undo step. Bringing a sticky note to the front or forward also
 * moves the text lying on it that the raise would otherwise leave below it (`carriedLabelsOf`:
 * unselected text of its parent above it and overlapping it; forward, only the text the note
 * hops over) in the same command, so what is written on the note stays on top of it (raising
 * a note carries its labels). A refusal (keys that cannot be ordered) writes nothing. Main thread.
 *
 * @param target - The document, origin and environment.
 * @param command - Which order command.
 * @param ids - The selected ids, first primary.
 * @returns The selected objects reordered and those left out (carried labels are not listed);
 *   nothing ran when `ids` is empty.
 */
export function reorderSelection(
  target: SelectionEditTarget,
  command: OrderCommand,
  ids: readonly ObjectId[],
): OrderTarget {
  const order = orderTargetOf(ids, sourceOf(target.store));
  if (order.ids.length > 0) {
    const { store, origin, environment } = target;
    const moved = RAISING_COMMANDS.has(command)
      ? carriedLabelsOf(store, order.ids, command === 'bringToFront' ? 'front' : 'forward')
      : order.ids;
    runCommand(store, origin, ORDER_COMMANDS[command], { ids: [...moved] }, environment);
  }
  return order;
}

/**
 * Locks or unlocks a selection (mod+shift+l) as one `setLocked` command, so one undo step: a
 * selection locked as a whole is unlocked, any other is locked (`lockToggleOf`). Main thread.
 *
 * @param target - The document, origin and environment.
 * @param ids - The selected ids.
 * @returns Whether a command ran (something selected exists).
 */
export function toggleSelectionLock(
  target: SelectionEditTarget,
  ids: readonly ObjectId[],
): boolean {
  const change = lockToggleOf(ids, sourceOf(target.store));
  if (change === undefined) return false;
  const { store, origin, environment } = target;
  const input = { ids: [...change.ids], locked: change.isLocked };
  runCommand(store, origin, setLockedCommand, input, environment);
  return true;
}
