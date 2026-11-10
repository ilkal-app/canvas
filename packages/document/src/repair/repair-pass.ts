import type { BoardObject, ObjectId, Page, PageId } from '@canvas/schema';

import type { BoardReader } from '../commands/command.js';
import type { DocumentTransaction } from '../store/document-store.js';

import { planPageRepair } from './page-repair.js';
import {
  applyParentCycleBreaks,
  findParentCycleBreaks,
  type ParentCycleBreak,
  type StoredObjectLookup,
} from './parent-cycles.js';
import {
  applyReferenceRepair,
  isEmptyRepair,
  planReferenceRepair,
  type ReferenceRepairPlan,
  type RepairView,
} from './reference-repair.js';

/** The writes of one repair transaction; returns the ids written. */
export type RepairWrite = (transaction: DocumentTransaction) => ObjectId[];

/** What the repair pass reads and writes through: the store's views and its transactions. */
export interface RepairPassHost {
  /** The board now, as the reader shows it. */
  readonly view: RepairView;
  /**
   * The live pages now, in page order.
   *
   * @returns The pages; never empty.
   */
  pages(): ReadonlyMap<PageId, Page>;
  /** The board with removed objects as last seen (`LastKnownBoard`). */
  readonly before: BoardReader;
  /** Objects as stored, before the reader shows any parent cycle broken. */
  readonly stored: StoredObjectLookup;
  /** Optional authority filter for automatic writes; refusal leaves the projected repair. */
  readonly allowsWrite?: (
    before: BoardObject | undefined,
    after: BoardObject | undefined,
  ) => boolean;
  /** Decodes what changed since the last read, so the views are current. */
  flush(): unknown;
  /**
   * Runs writes in one transaction with the system origin.
   *
   * @param write - The writes; returns the ids written.
   * @returns What `write` returned.
   */
  write(write: RepairWrite): ObjectId[];
}

/**
 * Sorts ids and drops repeats.
 *
 * @param ids - The ids.
 * @returns The distinct ids, sorted by UTF-16 code units.
 */
function distinctSorted(ids: readonly ObjectId[]): ObjectId[] {
  return [...new Set(ids)].sort();
}

/**
 * Adds the page rules' writes (`page-repair.ts`) to a reference plan: each page write replaces
 * the reference rules' write of the same object, which it was planned on.
 *
 * @param host - The store's views.
 * @param plan - The reference rules' plan.
 * @param touched - The objects the change touched.
 * @param isPagesChanged - Whether the change changed the pages.
 * @returns The plan with the page rules' writes.
 */
function withPageRepair(
  host: RepairPassHost,
  plan: ReferenceRepairPlan,
  touched: ReadonlySet<ObjectId>,
  isPagesChanged: boolean,
): ReferenceRepairPlan {
  const planned = new Map(plan.updated.map((object) => [object.id, object]));
  const deleted = new Set(plan.deleted);
  const pageWrites = planPageRepair(
    {
      view: {
        get: (id) => (deleted.has(id) ? undefined : (planned.get(id) ?? host.view.get(id))),
      },
      references: host.before.references,
      pages: host.pages(),
      touched,
      isPagesChanged,
    },
    planned,
  );
  if (pageWrites.length === 0) return plan;
  const updated = new Map<ObjectId, BoardObject>(planned);
  for (const object of pageWrites) updated.set(object.id, object);
  return { ...plan, updated: [...updated.values()] };
}

/**
 * The store's repair pass, after every applied update and after every undo or redo: the
 * reference repair (`reference-repair.ts`) and the parent-cycle break (`parent-cycles.ts`) of
 * what the change touched, in one transaction with the system origin, opened only when there is
 * something to write, so a pass that finds nothing writes nothing and passes stop. Neither
 * writes `updatedAt`, and no undo history records a system transaction. What it reads: the
 * touched objects, the dependents of the removed ones (reverse indexes) and the touched
 * objects' chains of ancestors, each object walked once, so the cost follows the change, not the
 * board. When the reference repair re-parented anything, the chains of what it wrote are walked
 * once more, since a re-parent onto a surviving ancestor can close a cycle that a concurrent
 * edit opened; a cycle break changes no other parent and closes none, so two transactions at
 * most.
 *
 * The page rules (`page-repair.ts`) are planned on what the reference rules leave and
 * written in the same transaction.
 *
 * @param host - The store's views and writes.
 * @param touched - The objects the change created, changed or removed.
 * @param isPagesChanged - Whether the change changed the pages (R1 then checks every root).
 * @returns The ids written or deleted, sorted.
 */
export function runRepairPass(
  host: RepairPassHost,
  touched: ReadonlySet<ObjectId>,
  isPagesChanged = false,
): ObjectId[] {
  if (touched.size === 0 && !isPagesChanged) return [];
  host.flush();
  const proposed = withPageRepair(
    host,
    planReferenceRepair(host.view, host.before, touched),
    touched,
    isPagesChanged,
  );
  const allowed = (id: ObjectId, next?: BoardObject) =>
    host.allowsWrite?.(host.stored(id), next) ?? true;
  const plan = {
    updated: proposed.updated.filter((object) => allowed(object.id, object)),
    deleted: proposed.deleted.filter((id) => allowed(id)),
  };
  const breaks = findParentCycleBreaks(host.stored, touched).filter(({ rerooted }) =>
    allowed(rerooted.id, rerooted),
  );
  if (isEmptyRepair(plan) && breaks.length === 0) return [];
  const planned = new Set([...plan.deleted, ...plan.updated.map(({ id }) => id)]);
  const unplanned = (candidates: readonly ParentCycleBreak[]) =>
    candidates.filter(({ rerooted }) => !planned.has(rerooted.id));
  const written = host.write((transaction) => [
    ...applyReferenceRepair(transaction, plan),
    ...applyParentCycleBreaks(transaction, unplanned(breaks)),
  ]);
  if (isEmptyRepair(plan)) return distinctSorted(written);
  host.flush();
  const closed = findParentCycleBreaks(host.stored, written).filter(({ rerooted }) =>
    allowed(rerooted.id, rerooted),
  );
  if (closed.length === 0) return distinctSorted(written);
  const more = host.write((transaction) => applyParentCycleBreaks(transaction, closed));
  return distinctSorted([...written, ...more]);
}
