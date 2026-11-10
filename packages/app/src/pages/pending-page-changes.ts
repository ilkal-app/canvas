import type { ChangeSet, TransactionOrigin } from '@canvas/document';
import type { ObjectId, PageId } from '@canvas/schema';

/** What a pending change set holds for one object. */
type PendingKind = 'created' | 'updated' | 'deleted';

/**
 * Each object's kind after another change of it: created then updated stays created, created
 * then deleted cancels out (`undefined`), deleted then created is an update, and otherwise the
 * later change wins.
 *
 * @param before - What the earlier change sets did to it, if anything.
 * @param after - What the next one does.
 * @returns What it is now, or `undefined` when nothing remains.
 */
function combined(before: PendingKind | undefined, after: PendingKind): PendingKind | undefined {
  if (before === 'created') return after === 'deleted' ? undefined : 'created';
  if (before === 'deleted' && after === 'created') return 'updated';
  return after;
}

/**
 * Whether two origins are the same actor and history.
 *
 * @param a - One origin.
 * @param b - The other.
 * @returns `true` when every field matches.
 */
function isSameOrigin(a: TransactionOrigin, b: TransactionOrigin): boolean {
  return (
    a.kind === b.kind &&
    a.principalId === b.principalId &&
    a.operatorId === b.operatorId &&
    a.historyKey === b.historyKey
  );
}

/**
 * A page's change sets held while a command's parts, or a grouped undo or redo, are applied
 * (`isApplyingInParts`), then delivered as one: page listeners (the hit index, the
 * scene feed, the selection, the text style panel) work once per command, not once per part.
 * Objects keep the order of their first change; pages are unioned in order of appearance. It
 * holds change sets of one source only: {@link PageChangeQueue} starts another batch for a set
 * of another origin or locality ({@link PendingPageChanges.isOtherSource}), so a set applied
 * remotely during a local command's parts is never reported as local.
 */
class PendingPageChanges {
  #first: ChangeSet | undefined;
  readonly #objects = new Map<ObjectId, PendingKind>();
  readonly #pages = new Set<PageId>();
  #hasPages = false;

  /**
   * Whether a change set comes from another source than the ones held: another origin, or
   * local against remote.
   *
   * @param changes - The next change set.
   * @returns `true` when something is held and its source differs.
   */
  isOtherSource(changes: ChangeSet): boolean {
    const first = this.#first;
    if (first === undefined) return false;
    return first.isLocal !== changes.isLocal || !isSameOrigin(first.origin, changes.origin);
  }

  /**
   * Holds one more change set, of the same source as the ones held.
   *
   * @param changes - The page's change set.
   */
  add(changes: ChangeSet): void {
    this.#first ??= changes;
    const kinds: readonly (readonly [PendingKind, readonly ObjectId[]])[] = [
      ['created', changes.created],
      ['updated', changes.updated],
      ['deleted', changes.deleted],
    ];
    for (const [kind, ids] of kinds) {
      for (const id of ids) {
        const next = combined(this.#objects.get(id), kind);
        // A map keeps a key where it was first set, so the object keeps its first change's place.
        if (next === undefined) this.#objects.delete(id);
        else this.#objects.set(id, next);
      }
    }
    if (changes.pages !== undefined) {
      this.#hasPages = true;
      for (const page of changes.pages) this.#pages.add(page);
    }
  }

  /**
   * Takes the held change sets as one and empties the buffer.
   *
   * @returns The merged change set, or `undefined` when none was held.
   */
  take(): ChangeSet | undefined {
    const first = this.#first;
    if (first === undefined) return undefined;
    const of = (kind: PendingKind): ObjectId[] =>
      [...this.#objects].flatMap(([id, held]) => (held === kind ? [id] : []));
    const merged: ChangeSet = {
      origin: first.origin,
      isLocal: first.isLocal,
      created: of('created'),
      updated: of('updated'),
      deleted: of('deleted'),
      ...(this.#hasPages ? { pages: [...this.#pages] } : {}),
    };
    this.#first = undefined;
    this.#objects.clear();
    this.#pages.clear();
    this.#hasPages = false;
    return merged;
  }
}

/**
 * A page's change sets held while a command's parts are applied, delivered in order when the
 * outermost part scope ends, so no page listener runs while an undo group is open.
 * Consecutive sets of one source within a scope merge into one batch; a set of another source
 * (a remote update applied between the parts) starts a batch of its own, so no delivered set
 * mixes sources. A set arriving while batches are delivered, from a listener's own command or
 * a remote update, queues behind them and the same delivery loop hands it out.
 */
export class PageChangeQueue {
  readonly #deliver: (changes: ChangeSet) => void;
  readonly #batches: PendingPageChanges[] = [];
  /** The batch the current part scope adds to, until its source changes or the scope ends. */
  #open: PendingPageChanges | undefined;
  #isDelivering = false;

  /**
   * Makes an empty queue.
   *
   * @param deliver - Hands one change set to the page's listeners; it may throw.
   */
  constructor(deliver: (changes: ChangeSet) => void) {
    this.#deliver = deliver;
  }

  /**
   * Holds a change set if it must wait: while parts are applied, or while held sets are being
   * delivered (then it is delivered by that loop, after the sets ahead of it).
   *
   * @param changes - The page's change set.
   * @param isInParts - Whether a command's parts are being applied (`isApplyingInParts`).
   * @returns `false` when nothing waits and the caller delivers it at once.
   * @throws {unknown} The first error a listener threw, when this call delivered.
   */
  hold(changes: ChangeSet, isInParts: boolean): boolean {
    if (!isInParts && !this.#isDelivering) return false;
    let batch = this.#open;
    if (batch === undefined || !isInParts || batch.isOtherSource(changes)) {
      batch = new PendingPageChanges();
      this.#batches.push(batch);
      this.#open = isInParts ? batch : undefined;
    }
    batch.add(changes);
    return true;
  }

  /**
   * Ends the current part scope's batch and delivers every held batch in order, each as one
   * change set, including those queued meanwhile. Every batch is delivered; the first listener
   * error is rethrown after the last. A call during delivery returns at once.
   *
   * @throws {unknown} The first error a listener threw.
   */
  endParts(): void {
    this.#open = undefined;
    if (this.#isDelivering) return;
    this.#isDelivering = true;
    const errors: unknown[] = [];
    try {
      for (let batch = this.#batches.shift(); batch !== undefined; batch = this.#batches.shift()) {
        const merged = batch.take();
        if (merged === undefined) continue;
        try {
          this.#deliver(merged);
        } catch (error) {
          errors.push(error);
        }
      }
    } finally {
      this.#isDelivering = false;
    }
    if (errors.length > 0) throw errors[0];
  }
}
