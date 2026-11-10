import * as Y from 'yjs';

import type { UpdateShape } from '../assets/update-scan.js';
import type { TransactionOrigin } from '../origin/transaction-origin.js';

import type { DocumentUpdate } from './document-store.js';
import { splitUpdate, type HeldDeletes } from './held-deletes.js';
import { notifyAll } from './notify-all.js';

/** Where `applyRemoteUpdate` puts the deletions it newly held. */
export interface HeldOutcome {
  /**
   * The update's deletions now held, as an update with no structs, which Yjs reports to no
   * listener (see `HeldDeletes.apply`). Set inside the transaction, before Yjs notifies any
   * observer, so it is there even when an observer or update listener throws.
   */
  deletes?: Uint8Array;
}

/**
 * Applies received bytes and gives any combined held structs one integration pass, preserving
 * genuine gaps, then the update's deletions, of which those that could leave a key inside an
 * object with no value wait while structs are pending (`held-deletes.ts`). Every pass
 * shares a remote transaction and one observer notification.
 *
 * @param doc - The store's document.
 * @param update - Received Yjs v1 bytes.
 * @param shape - Where its delete set starts (`readUpdateShape`).
 * @param heldDeletes - The store's held deletions.
 * @param origin - The validated remote attribution.
 * @param held - Receives the update's deletions now held.
 * @throws {unknown} A decoding error or an error from a document listener.
 */
export function applyRemoteUpdate(
  doc: Y.Doc,
  update: Uint8Array,
  shape: UpdateShape,
  heldDeletes: HeldDeletes,
  origin: TransactionOrigin,
  held: HeldOutcome,
): void {
  const { structs, deletes } = shape.hasDeletes
    ? splitUpdate(update, shape)
    : { structs: update, deletes: undefined };
  Y.transact(
    doc,
    () => {
      Y.applyUpdate(doc, structs, origin);
      // Merged deliveries can leave Yjs's missing-clock hints ahead of a dependency already
      // held in pendingStructs. Replaying the combined bytes checks the dependencies
      // themselves. There is no loop or reset: genuinely missing structs and deletes stay held.
      const pending = doc.store.pendingStructs;
      if (pending !== null) Y.applyUpdateV2(doc, pending.update, origin);
      const newlyHeld = heldDeletes.apply(doc, deletes, origin);
      if (newlyHeld !== undefined) held.deletes = newlyHeld;
    },
    origin,
    false,
  );
}

/**
 * Reports the deletions an update newly held to the update listeners, as a remote update: Yjs
 * reports no update for deletions it did not apply, and the device cache must still log them.
 * Call it whether or not applying the update threw: `held` is filled before Yjs
 * notifies any listener, so a listener that threw on the rest of the update does not lose them.
 * Every listener is called even when one throws (`notifyAll`).
 *
 * @param listeners - The store's update listeners.
 * @param held - What `applyRemoteUpdate` held.
 * @param origin - The update's origin.
 * @throws {unknown} The first error a listener threw.
 */
export function reportHeldDeletes(
  listeners: ReadonlySet<(update: DocumentUpdate) => void>,
  held: HeldOutcome,
  origin: TransactionOrigin,
): void {
  if (held.deletes === undefined) return;
  notifyAll(listeners, Object.freeze({ update: held.deletes, origin, isLocal: false }));
}

/**
 * Applies a remote update (`applyRemoteUpdate`) and then, whatever happened, reports the
 * deletions it newly held (`reportHeldDeletes`), so a listener that throws on the update does not
 * keep them from the device cache. Never throws: it returns the first failure, a listener's on
 * the update before one on the report, for `finishRemoteUpdate`.
 *
 * @param doc - The store's document.
 * @param update - Received Yjs v1 bytes.
 * @param shape - Where its delete set starts.
 * @param heldDeletes - The store's held deletions.
 * @param origin - The validated remote attribution.
 * @param listeners - The store's update listeners.
 * @returns The first failure, if anything threw.
 */
export function applyAndReport(
  doc: Y.Doc,
  update: Uint8Array,
  shape: UpdateShape,
  heldDeletes: HeldDeletes,
  origin: TransactionOrigin,
  listeners: ReadonlySet<(update: DocumentUpdate) => void>,
): { readonly error: unknown } | undefined {
  const held: HeldOutcome = {};
  let failure: { readonly error: unknown } | undefined;
  try {
    applyRemoteUpdate(doc, update, shape, heldDeletes, origin, held);
  } catch (error) {
    failure = { error };
  }
  try {
    reportHeldDeletes(listeners, held, origin);
  } catch (error) {
    failure ??= { error };
  }
  return failure;
}

/**
 * The version check after Yjs applied an update, run even when a listener threw while the update
 * was applied; both failures are reported, the listener's first.
 *
 * @param failure - What a listener threw while the update was applied, if anything.
 * @param check - The version check.
 * @throws {unknown} The version check's failure, or an `AggregateError` of the listener's and it.
 */
export function checkRemoteUpdate(
  failure: { readonly error: unknown } | undefined,
  check: () => void,
): void {
  try {
    check();
  } catch (versionError) {
    if (failure === undefined) throw versionError;
    throw new AggregateError(
      [failure.error, versionError],
      'A listener failed during applyUpdate, and the document is one this build cannot read',
    );
  }
}

/**
 * The reference repair after an update passed its version check, run even when a listener threw
 * while the update was applied; then that listener's failure, if any.
 *
 * @param failure - What a listener threw while the update was applied, if anything.
 * @param repair - The reference repair.
 * @throws {unknown} The one failure, or an `AggregateError` of the listener's and the repair's.
 */
export function repairRemoteUpdate(
  failure: { readonly error: unknown } | undefined,
  repair: () => void,
): void {
  try {
    repair();
  } catch (repairError) {
    if (failure === undefined) throw repairError;
    throw new AggregateError(
      [failure.error, repairError],
      'A listener failed during applyUpdate, and so did the reference repair after it',
    );
  }
  if (failure !== undefined) throw failure.error;
}

/**
 * Finishes an `applyUpdate` after Yjs applied the update: the version check, then the reference
 * repair, both even when a listener threw while the update was applied; every failure is
 * reported, a listener's first.
 *
 * @param failure - What a listener threw while the update was applied, if anything.
 * @param check - The version check.
 * @param repair - The reference repair.
 * @throws {unknown} The one failure, or an `AggregateError` of the listener's and a later one.
 */
export function finishRemoteUpdate(
  failure: { readonly error: unknown } | undefined,
  check: () => void,
  repair: () => void,
): void {
  checkRemoteUpdate(failure, check);
  repairRemoteUpdate(failure, repair);
}
