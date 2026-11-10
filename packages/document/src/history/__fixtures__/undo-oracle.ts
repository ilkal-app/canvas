import * as Y from 'yjs';

import type { DocumentStore } from '../../store/document-store.js';
import { internalsOf } from '../../store/internal.js';
import { depthsOf } from '../history-depths.js';
import type { UndoHistory } from '../undo-manager.js';

// The oracle of the creation guard's property test (fix round 1, I3). It knows what the
// history cannot: which items the product wrote (it watches every store's transactions), who
// first wrote a value an undo or redo copied (it follows `item.redone` back to the original),
// and each step's causal past (it keeps its own model of the two stacks). The invariant: after
// any undo or redo by a client, no value another person wrote since the step, and that was on
// the client's board before the click, is gone after it.

/** A state vector: clock per Yjs client id. */
export type StateVector = ReadonlyMap<number, number>;

/**
 * Reads a store's state vector.
 *
 * @param store - The store.
 * @returns Clock per client id.
 */
export function stateOf(store: DocumentStore): StateVector {
  return Y.decodeStateVector(store.encodeStateVector());
}

/** Records the items every watched store's product (not a person) writes locally. */
export class ProductItems {
  readonly #ranges: [number, number, number][] = [];

  /**
   * Starts watching a store.
   *
   * @param store - The store.
   */
  watch(store: DocumentStore): void {
    internalsOf(store).doc.on('afterTransaction', (transaction: Y.Transaction) => {
      const kind = (transaction.origin as { readonly kind?: unknown } | null)?.kind;
      if (!transaction.local || kind === 'user' || kind === 'agent' || kind === 'undo') return;
      const client = transaction.doc.clientID;
      const start = transaction.beforeState.get(client) ?? 0;
      const end = transaction.afterState.get(client) ?? 0;
      if (end > start) this.#ranges.push([client, start, end]);
    });
  }

  /**
   * Tells whether the product wrote an item.
   *
   * @param item - The item.
   * @returns `true` when a watched store's product wrote it.
   */
  includes(item: Y.Item): boolean {
    const { client, clock } = item.id;
    return this.#ranges.some(
      ([owner, start, end]) => owner === client && clock >= start && clock < end,
    );
  }
}

/**
 * Maps each copy an undo or redo made to the item it copied, over a whole document.
 *
 * @param doc - The document.
 * @returns Copy id (`client:clock`) to the copied item.
 */
function copiesOf(doc: Y.Doc): Map<string, Y.Item> {
  const copied = new Map<string, Y.Item>();
  for (const structs of doc.store.clients.values()) {
    for (const struct of structs) {
      if (struct instanceof Y.Item && struct.redone !== null) {
        copied.set(`${String(struct.redone.client)}:${String(struct.redone.clock)}`, struct);
      }
    }
  }
  return copied;
}

/**
 * The item a value was first written as, following copies back.
 *
 * @param item - A value.
 * @param copied - {@link copiesOf} the document.
 * @returns The original item.
 */
function originalOf(item: Y.Item, copied: ReadonlyMap<string, Y.Item>): Y.Item {
  let original = item;
  for (;;) {
    const source = copied.get(`${String(original.id.client)}:${String(original.id.clock)}`);
    if (source === undefined) return original;
    original = source;
  }
}

/**
 * Every live item on a board: object entries, each key's current value, and what lives inside
 * shared values (labels, texts, networks).
 *
 * @param type - A shared type, the objects map at first.
 * @param into - Where to collect.
 * @returns `into`.
 */
function liveItemsIn(type: Y.AbstractType<unknown>, into: Y.Item[] = []): Y.Item[] {
  const values = [...type._map.values()];
  for (let item = type._start; item !== null; item = item.right) values.push(item);
  for (const value of values) {
    if (value.deleted) continue;
    into.push(value);
    if (value.content instanceof Y.ContentType) {
      liveItemsIn(value.content.type as Y.AbstractType<unknown>, into);
    }
  }
  return into;
}

/**
 * The id of the object an item lies in.
 *
 * @param item - The item.
 * @param objects - The objects map.
 * @returns The object id.
 */
function objectIdOf(item: Y.Item, objects: Y.Map<unknown>): string {
  let entry = item;
  while (entry.parent !== objects) {
    const owner = (entry.parent as Y.AbstractType<unknown>)._item;
    if (owner === null) return '?';
    entry = owner;
  }
  return entry.parentSub ?? '?';
}

/**
 * Tells whether an item is a new write of the clicking client in the click: its client's item,
 * in the click's clock range, copying no earlier item (a restore makes copies).
 *
 * @param item - The item.
 * @param doc - The clicking client's document.
 * @param range - The clicking client's clocks written in the click, `[start, end)`.
 * @returns `true` for a fresh write of the click.
 */
function isFreshWriteOfClick(item: Y.Item, doc: Y.Doc, range: readonly [number, number]): boolean {
  const { client, clock } = item.id;
  if (client !== doc.clientID || clock < range[0] || clock >= range[1]) return false;
  return !copiesOf(doc).has(`${String(client)}:${String(clock)}`);
}

/**
 * Tells whether a deleted `z` was re-keyed by the reference repair the undo or redo runs in its
 * own transaction, after the click moved the object to another parent: the repair's new key
 * replaced the lost one directly, and the object's placement changed in the same click. The
 * controller's ruling (fix round 3): a stacking key orders an object among the children
 * of the parent it has just left, so re-keying it in the new parent loses nothing. Only `z`,
 * and only then: a repair write over any other reference key (an object's placement in a
 * frame, a connector end, a comment pin) is a loss the creation guard exists to prevent.
 *
 * @param item - The deleted value.
 * @param doc - The clicking client's document.
 * @param range - The clicking client's clocks written in the click, `[start, end)`.
 * @returns `true` when the click's repair re-keyed it after a re-parent.
 */
function isReKeyedAfterReparent(
  item: Y.Item,
  doc: Y.Doc,
  range: readonly [number, number],
): boolean {
  if (item.parentSub !== 'z') return false;
  const map = item.parent as Y.AbstractType<unknown>;
  const current = map._map.get('z');
  const placement = map._map.get('placement');
  return (
    current?.left === item &&
    isFreshWriteOfClick(current, doc, range) &&
    placement?.id.client === doc.clientID &&
    placement.id.clock >= range[0] &&
    placement.id.clock < range[1]
  );
}

/**
 * A step in the oracle's model: its causal past, the command it came from, and how many entries
 * it holds on the history's stack (a step written in parts, holds one per part).
 */
interface ModelStep {
  readonly past: StateVector;
  readonly what: string;
  readonly parts: number;
}

/**
 * How many history stack entries model steps hold.
 *
 * @param steps - The steps.
 * @returns The sum of their parts.
 */
function entriesOf(steps: readonly ModelStep[]): number {
  return steps.reduce((count, step) => count + step.parts, 0);
}

/** One client of the property test, with the oracle's model of its history's stacks. */
export class ModelledClient {
  readonly store: DocumentStore;
  readonly history: UndoHistory;
  /** The steps on the undo stack, oldest first. */
  readonly undoSteps: ModelStep[] = [];
  /** The steps on the redo stack, oldest first. */
  redoSteps: ModelStep[] = [];

  /**
   * Wraps a store and its history.
   *
   * @param store - The store.
   * @param history - The history of the store's user.
   */
  constructor(store: DocumentStore, history: UndoHistory) {
    this.store = store;
    this.history = history;
  }

  /**
   * Notes a command of the client's user that wrote something: a new step.
   *
   * @param past - The state vector before the command.
   * @param what - The command, for failure messages.
   * @param parts - How many transactions it was written in (`runAsOneStep`); one by default.
   */
  noteStep(past: StateVector, what: string, parts = 1): void {
    this.undoSteps.push({ past, what, parts });
    this.redoSteps = [];
    this.#expectDepths(what);
  }

  /**
   * Checks the model holds as many steps on each stack as the history does.
   *
   * @param when - What just happened, for the message.
   * @throws {Error} When they differ: a step dropped or doubled.
   */
  #expectDepths(when: string): void {
    const { undo, redo } = depthsOf(this.history);
    if (undo !== entriesOf(this.undoSteps) || redo !== entriesOf(this.redoSteps)) {
      const model = `${String(entriesOf(this.undoSteps))}/${String(entriesOf(this.redoSteps))}`;
      throw new Error(`stacks ${String(undo)}/${String(redo)}, model ${model}, after ${when}`);
    }
  }

  /**
   * Undoes or redoes one step, and checks the invariant.
   *
   * @param direction - Which.
   * @param products - The product's items.
   * @returns A description of each value lost, empty when none.
   * @throws {Error} When the model and the history disagree about the stacks.
   */
  click(direction: 'undo' | 'redo', products: ProductItems): string[] {
    const isUndo = direction === 'undo';
    const [from, to] = isUndo ? [this.undoSteps, this.redoSteps] : [this.redoSteps, this.undoSteps];
    this.#expectDepths(`before ${direction}`);
    const step = from.pop();
    if (step === undefined) return [];
    const now = stateOf(this.store);
    const kept = this.#othersValuesSince(step.past, products);
    const { doc, objects } = internalsOf(this.store);
    const recorded = { start: -1, end: 0, isObjectsChanged: false, changedParts: 0 };
    const onTransaction = (transaction: Y.Transaction): void => {
      const kind = (transaction.origin as { readonly kind?: unknown } | null)?.kind;
      if (!transaction.local || kind !== 'undo') return;
      // A step in parts runs one transaction per part: the click's range spans them all.
      if (recorded.start < 0) recorded.start = transaction.beforeState.get(doc.clientID) ?? 0;
      recorded.end = transaction.afterState.get(doc.clientID) ?? 0;
      recorded.isObjectsChanged = [...transaction.changedParentTypes.keys()].some(
        (type) => (type as unknown) === objects,
      );
      if (recorded.isObjectsChanged) recorded.changedParts += 1;
    };
    const before = depthsOf(this.history);
    doc.on('afterTransaction', onTransaction);
    let isChanged: boolean;
    try {
      isChanged = isUndo ? this.history.undo() : this.history.redo();
    } finally {
      doc.off('afterTransaction', onTransaction);
    }
    // The model's own prediction: one step leaves its stack, and its inverse goes onto the other
    // when the click changed something and Yjs records it, which it does when the click's
    // transaction changed a live type under the objects map (an undo that wrote only into a map
    // deleted meanwhile records nothing, a Yjs rule the model follows). The history must agree,
    // so a step it drops or doubles fails the test.
    // In parts, each part that changed a live type pushes its own inverse.
    const pushed =
      step.parts === 1 ? Number(isChanged && recorded.isObjectsChanged) : recorded.changedParts;
    const isPushed = pushed > 0;
    const after = depthsOf(this.history);
    const [fromBefore, fromAfter, toBefore, toAfter] = isUndo
      ? [before.undo, after.undo, before.redo, after.redo]
      : [before.redo, after.redo, before.undo, after.undo];
    const other = isUndo ? 'redo' : 'undo';
    if (fromAfter !== fromBefore - step.parts) {
      throw new Error(`${direction} took ${String(fromBefore - fromAfter)} steps off its stack`);
    }
    if (toAfter - toBefore !== pushed) {
      throw new Error(
        `${direction} ${toAfter - toBefore < pushed ? 'dropped' : 'added'} a step on the ${other} stack`,
      );
    }
    if (isPushed) to.push({ past: now, what: step.what, parts: pushed });
    this.#expectDepths(direction);
    return kept
      .filter(
        ({ item }) =>
          item.deleted && !isReKeyedAfterReparent(item, doc, [recorded.start, recorded.end]),
      )
      .map(({ where, objectId }) => {
        const removed = objects.has(objectId) ? '' : ' (object removed)';
        return `${where}${removed} undoing ${step.what.slice(0, 60)}`;
      });
  }

  /**
   * The live values another person wrote after a step's causal past, by their first writer.
   *
   * @param past - The step's causal past.
   * @param products - The product's items.
   * @returns Each value with where it lives.
   */
  #othersValuesSince(past: StateVector, products: ProductItems) {
    const { doc, objects } = internalsOf(this.store);
    const copied = copiesOf(doc);
    return liveItemsIn(objects as unknown as Y.AbstractType<unknown>).flatMap((item) => {
      const original = originalOf(item, copied);
      const { client, clock } = original.id;
      const isOthers = client !== doc.clientID && !products.includes(original);
      if (!isOthers || clock + original.length <= (past.get(client) ?? 0)) return [];
      const objectId = objectIdOf(item, objects);
      const where = `${objectId}.${item.parentSub ?? 'text'} by ${String(client)}:${String(clock)}`;
      return [{ item, where, objectId }];
    });
  }
}
