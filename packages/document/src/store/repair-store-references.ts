import type { BoardObject, ObjectId, StyleId } from '@canvas/schema';

import type { BoardReader } from '../commands/command.js';
import { planRelayout } from '../layout/plan-relayout.js';
import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { isComponentContent } from '../repair/component-repair-scope.js';
import { materializeInstanceRepairs } from '../repair/materialize-instance-repairs.js';
import type { RepairView } from '../repair/reference-repair.js';
import { runRepairPass, type RepairWrite } from '../repair/repair-pass.js';
import { repairStyleBindings } from '../repair/style-binding-repair.js';

import type { DocumentStore, RepairMode } from './document-store.js';
import { DocumentWriteError } from './document-write-error.js';
import type { ObjectCache } from './object-cache.js';

/** The views and authority used for automatic reference repair. */
interface StoreRepairContext {
  readonly store: DocumentStore;
  readonly cache: ObjectCache;
  readonly before: BoardReader;
  readonly view: RepairView;
  readonly mode: RepairMode;
  /** The named styles changed since the last pass, whose users the binding repair checks. */
  readonly changedStyles?: ReadonlySet<StyleId>;
}

/**
 * Runs role-aware reference repair. Agents project component content without emitting writes
 * that the main's ownership boundary would refuse; their unrelated repairs remain writable.
 *
 * @param context - Store views and current repair authority.
 * @param context.store - The writable store.
 * @param context.cache - Decoded and projected object views.
 * @param context.before - The stored and last-known board.
 * @param context.view - The repair reader with entry-presence checks.
 * @param context.mode - Current automatic repair authority.
 * @param context.changedStyles - The named styles changed since the last pass.
 * @param touched - Changed identities.
 * @param isPagesChanged - Whether pages also changed.
 * @returns Identities physically repaired.
 */
export function repairStoreReferences(
  { store, cache, before, view, mode, changedStyles = new Set() }: StoreRepairContext,
  touched: ReadonlySet<ObjectId>,
  isPagesChanged: boolean,
): ObjectId[] {
  if (mode === 'read-only') {
    cache.flush();
    return [];
  }
  const get = (id: ObjectId) => cache.stored(id) ?? before.get(id);
  const host = {
    view: mode === 'agent-write' ? { ...view, get: (id: ObjectId) => cache.stored(id) } : view,
    allowsWrite: (previous: BoardObject | undefined, next: BoardObject | undefined) =>
      mode !== 'agent-write' ||
      (!isComponentContent(previous, get) && !isComponentContent(next, get)),
    pages: () => cache.pages(),
    before,
    stored: (id: ObjectId) => cache.stored(id),
    flush: () => cache.flush(),
    write: (write: RepairWrite) => store.transact(SYSTEM_ORIGIN, write),
  };
  const written = runRepairPass(host, touched, isPagesChanged);
  const laid = relayoutTouched(store, before, touched, written, host.allowsWrite);
  // Named styles: what a merge left naming a style it no longer holds takes its value.
  const restyled = repairStyleBindings(store, touched, changedStyles, host.allowsWrite);
  return materializeInstanceRepairs(
    store,
    [...written, ...laid, ...restyled],
    mode === 'write' ? cache.instanceRepairs() : [],
  );
}

/**
 * Re-lays the auto-layout containers a change touched, with the system origin: a
 * command lays out what it writes, but concurrent edits each laid out on their own view, so the
 * merge is laid out once more here, after every applied update and every undo or redo, and every
 * client converges on the same places (`planRelayout` is deterministic). Writes only what
 * changes, so a pass after a laid-out change writes nothing. Each write is subject to the same
 * repair authority as reference repair (an agent writes no component content).
 *
 * @param store - The writable store.
 * @param before - The board before the change, for the parents removed objects had.
 * @param touched - What the change touched.
 * @param repaired - What reference repair just wrote.
 * @param allowsWrite - Whether repair may write an object, before and after.
 * @returns The ids it wrote.
 */
function relayoutTouched(
  store: DocumentStore,
  before: BoardReader,
  touched: ReadonlySet<ObjectId>,
  repaired: readonly ObjectId[],
  allowsWrite: (previous: BoardObject | undefined, next: BoardObject | undefined) => boolean,
): ObjectId[] {
  const reach = new Set<ObjectId>([...touched, ...repaired]);
  for (const id of [...reach]) {
    const parent = before.get(id)?.parentId;
    if (parent != null) reach.add(parent);
  }
  const planned = planRelayout(
    {
      get: (id) => store.get(id),
      childrenOf: (id) => store.references.childrenOf(id),
      instancesOf: (mainId) => store.references.instancesOf(mainId),
    },
    reach,
  );
  const allowed = [...planned.values()].filter((object) =>
    allowsWrite(store.get(object.id), object),
  );
  if (allowed.length === 0) return [];
  const written: ObjectId[] = [];
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of allowed) {
      try {
        transaction.setObject(object);
        written.push(object.id);
      } catch (error) {
        // A peer's raw write can leave a child the relay still admits but whose laid-out
        // container would not be (a hugging size past the extent a renderer draws): that
        // container keeps its place, as reference repair keeps an object it cannot write.
        if (!(error instanceof DocumentWriteError)) throw error;
      }
    }
  });
  return written;
}
