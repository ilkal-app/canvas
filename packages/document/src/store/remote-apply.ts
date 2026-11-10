import type { ObjectId } from '@canvas/schema';

import { readUpdateShape, type UpdateShape } from '../assets/update-scan.js';
import type { TransactionOrigin } from '../origin/transaction-origin.js';

import type { ApplyUpdateInStepsOptions, ApplyUpdateOptions } from './document-update.js';
import { checkRemoteUpdate, finishRemoteUpdate, repairRemoteUpdate } from './remote-update.js';

/** What applying an update in Yjs left for the version check and the repair. */
export interface IntegratedUpdate {
  /** What a listener threw while the update was applied, if anything. */
  readonly failure: { readonly error: unknown } | undefined;
  /** The objects the update created, changed or removed. */
  readonly changed: ReadonlySet<ObjectId>;
  /** Whether the update changed the pages. */
  readonly isPagesChanged: boolean;
}

/** The store's side of a remote apply (`YjsDocumentStore`), whole or in steps. */
export interface RemoteApplyHost {
  /** Throws unless the store may take an update now. */
  readonly checkIdle: () => void;
  /** Validates the update's origin and issues the one the store records. */
  readonly issue: (origin: TransactionOrigin) => TransactionOrigin;
  /** Applies the bytes in Yjs, never throwing a listener's failure. */
  readonly integrate: (
    update: Uint8Array,
    shape: UpdateShape,
    origin: TransactionOrigin,
    isSilent: boolean,
  ) => IntegratedUpdate;
  /** The version check of what the update changed. */
  readonly check: (applied: IntegratedUpdate) => void;
  /** The reference repair of what the update changed; nothing after `destroy()`. */
  readonly repair: (applied: IntegratedUpdate) => void;
  /** Whether the store has been destroyed. */
  readonly isDestroyed: () => boolean;
  /** Marks a stepped apply pending, so writes and other updates throw meanwhile. */
  readonly setStepping: (isStepping: boolean) => void;
}

/**
 * Applies a remote update in one go: the scan, the Yjs apply, the version check, the repair.
 *
 * @param host - The store.
 * @param update - Update bytes, Yjs update format v1.
 * @param origin - Where the update is attributed to.
 * @param options - How it is applied.
 * @throws {unknown} As `DocumentStore.applyUpdate`.
 */
export function applyRemote(
  host: RemoteApplyHost,
  update: Uint8Array,
  origin: TransactionOrigin,
  options?: ApplyUpdateOptions,
): void {
  host.checkIdle();
  const shape = readUpdateShape(update);
  const applied = host.integrate(update, shape, host.issue(origin), options?.isSilent === true);
  finishRemoteUpdate(
    applied.failure,
    () => {
      host.check(applied);
    },
    () => {
      host.repair(applied);
    },
  );
}

/**
 * Applies a remote update in three browser tasks: the scan; the Yjs apply and the
 * version check; the repair, yielding between them. Writes throw while it is pending; after
 * `destroy()` no further step runs.
 *
 * @param host - The store.
 * @param update - Update bytes, Yjs update format v1.
 * @param origin - Where the update is attributed to.
 * @param options - How it is applied, and how to yield.
 * @returns Resolves once applied and repaired, or once the store is destroyed.
 * @throws {unknown} As `DocumentStore.applyUpdate`, or what a yield rejected with.
 */
export async function applyRemoteInSteps(
  host: RemoteApplyHost,
  update: Uint8Array,
  origin: TransactionOrigin,
  options: ApplyUpdateInStepsOptions,
): Promise<void> {
  host.checkIdle();
  const shape = readUpdateShape(update);
  const validOrigin = host.issue(origin);
  let applied: IntegratedUpdate;
  let failure: { readonly error: unknown } | undefined;
  host.setStepping(true);
  try {
    await options.yieldToBrowser();
    if (host.isDestroyed()) return;
    applied = host.integrate(update, shape, validOrigin, options.isSilent === true);
    failure = applied.failure;
    checkRemoteUpdate(failure, () => {
      host.check(applied);
    });
    try {
      await options.yieldToBrowser();
    } catch (error) {
      // The update is in: it is repaired all the same before the rejection.
      failure ??= { error };
    }
  } finally {
    host.setStepping(false);
  }
  repairRemoteUpdate(failure, () => {
    host.repair(applied);
  });
}
