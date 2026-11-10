import { z } from 'zod';

import type {
  BoardObject,
  BoardTimer,
  ObjectId,
  Page,
  PageId,
  Segment,
  StyleId,
  TextStyle,
  TokenId,
  TokenTable,
  Vertex,
} from '@canvas/schema';

import { RecordingTransaction } from '../bound/recording-transaction.js';
import type { TextStylePatch } from '../codec/style-attributes.js';
import type { RestoreMarker } from '../meta/restore-marker.js';
import type { TransactionOrigin } from '../origin/transaction-origin.js';
import type { PageCreation } from '../pages/page-writes.js';
import type { DocumentTransaction, ObjectPatch } from '../store/document-store.js';
import type { StyleCreation, StyleKind, StyleTable, StyleWrite } from '../styles/style-map.js';
import type { TokenCreation, TokenWrite } from '../tokens/token-writes.js';

import { commandError, type CommandError } from './command-error.js';
import type { BoardReader, Command, CommandContext } from './command.js';

/** The most items one batch takes. */
export const MAX_BATCH_ITEMS = 100;

/** A batch's plan: every item, planned in order. */
export interface BatchPlan<Input, Plan> {
  /** The items, in the order given: each one's parsed input and the wrapped command's plan. */
  readonly items: readonly {
    /** The item's parsed input. */
    readonly input: Input;
    /** The wrapped command's plan for it. */
    readonly plan: Plan;
  }[];
}

/**
 * The board as the next item of a batch sees it: the board's own reverse indexes and pages
 * reader, with the objects, colour tokens, named styles and board timer the earlier items wrote over
 * it.
 *
 * @param board - The board.
 * @param recorded - The earlier items' writes.
 * @returns The reader.
 */
function overlayOf(board: BoardReader, recorded: RecordingTransaction): BoardReader {
  return {
    get: (id) => recorded.get(id),
    references: board.references,
    readTokens: () => recorded.tokens(),
    readTextStyles: () => recorded.namedStyles('text'),
    readEffectStyles: () => recorded.namedStyles('effect'),
    readPages: () => recorded.pages(),
    // The timer the earlier items left.
    boardTimer: {
      get current() {
        return recorded.boardTimer();
      },
    },
    ...(board.defaultPageId === undefined ? {} : { defaultPageId: board.defaultPageId }),
  };
}

/**
 * The objects an item created, deleted or moved to another parent: what a batch refuses, as its
 * reader does not see such changes in the board's reverse indexes.
 *
 * @param before - The writes before the item.
 * @param after - The writes after it.
 * @param board - The board, for an object no earlier item wrote.
 * @returns The ids.
 */
function restructured(
  before: ReadonlyMap<ObjectId, BoardObject | null>,
  after: ReadonlyMap<ObjectId, BoardObject | null>,
  board: BoardReader,
): ObjectId[] {
  const ids: ObjectId[] = [];
  for (const [id, object] of after) {
    if (before.has(id) && before.get(id) === object) continue;
    const previous = before.has(id) ? before.get(id) : board.get(id);
    if (object === null || previous === undefined || previous === null) ids.push(id);
    else if (previous.parentId !== object.parentId) ids.push(id);
  }
  return ids;
}

/**
 * Errors of one item, their paths prefixed with the batch's key and the item's index.
 *
 * @param errors - The item's errors.
 * @param key - The batch's key.
 * @param index - The item's index.
 * @returns The errors.
 */
function itemErrors(errors: readonly CommandError[], key: string, index: number): CommandError[] {
  return errors.map((error) => ({ ...error, path: [key, index, ...error.path] }));
}

/**
 * A transaction that writes each object and colour token once: a batch's items write
 * the same object or token in turn (three overrides of one instance), and a field written more than
 * once in one transaction is not one clean undo step. Object and token writes are kept, merged in
 * order, and written at the end (`flush`); an object's text, vertex, segment or delete operation
 * first writes what is kept for it, so the operation sees it. Everything else goes straight
 * through.
 */
class CoalescingTransaction implements DocumentTransaction {
  readonly #inner: DocumentTransaction;
  readonly #objects = new Map<ObjectId, BoardObject>();
  readonly #tokens = new Map<TokenId, { token: TokenWrite; creation: TokenCreation }>();

  /**
   * Wraps a transaction.
   *
   * @param inner - The real transaction.
   */
  constructor(inner: DocumentTransaction) {
    this.#inner = inner;
  }

  get origin(): TransactionOrigin {
    return this.#inner.origin;
  }

  markRestore(marker: RestoreMarker): void {
    this.#inner.markRestore(marker);
  }

  get(id: ObjectId): BoardObject | undefined {
    return this.#objects.get(id) ?? this.#inner.get(id);
  }

  setObject(object: BoardObject): void {
    this.#objects.set(object.id, object);
  }

  patchObject(id: ObjectId, patch: ObjectPatch): void {
    const current = this.get(id);
    if (current === undefined) {
      this.#inner.patchObject(id, patch);
      return;
    }
    this.#objects.set(id, { ...current, ...patch } as BoardObject);
  }

  pages(): ReadonlyMap<PageId, Page> {
    return this.#inner.pages();
  }

  setPage(page: Page, creation: PageCreation): void {
    this.#inner.setPage(page, creation);
  }

  deletePage(pageId: PageId): boolean {
    return this.#inner.deletePage(pageId);
  }

  tokens(): TokenTable {
    return this.#inner.tokens();
  }

  setToken(token: TokenWrite, creation: TokenCreation): void {
    const first = this.#tokens.get(token.id);
    this.#tokens.set(token.id, { token, creation: first?.creation ?? creation });
  }

  deleteToken(tokenId: TokenId): boolean {
    this.#tokens.delete(tokenId);
    return this.#inner.deleteToken(tokenId);
  }

  setBoardTimer(timer: BoardTimer | undefined): void {
    this.#inner.setBoardTimer(timer);
  }

  setStickyAuthors(isShown: boolean): void {
    this.#inner.setStickyAuthors(isShown);
  }

  namedStyles<Kind extends StyleKind>(kind: Kind): StyleTable<Kind> {
    return this.#inner.namedStyles(kind);
  }

  setNamedStyle<Kind extends StyleKind>(
    kind: Kind,
    style: StyleWrite<Kind>,
    creation: StyleCreation,
  ): void {
    this.#inner.setNamedStyle(kind, style, creation);
  }

  deleteNamedStyle(kind: StyleKind, styleId: StyleId): boolean {
    return this.#inner.deleteNamedStyle(kind, styleId);
  }

  deleteObject(id: ObjectId): boolean {
    this.#objects.delete(id);
    return this.#inner.deleteObject(id);
  }

  insertText(id: ObjectId, index: number, text: string, style: TextStyle): void {
    this.#flushObject(id);
    this.#inner.insertText(id, index, text, style);
  }

  deleteText(id: ObjectId, index: number, length: number): void {
    this.#flushObject(id);
    this.#inner.deleteText(id, index, length);
  }

  formatText(id: ObjectId, index: number, length: number, patch: TextStylePatch): void {
    this.#flushObject(id);
    this.#inner.formatText(id, index, length, patch);
  }

  setVertex(id: ObjectId, vertex: Vertex): void {
    this.#flushObject(id);
    this.#inner.setVertex(id, vertex);
  }

  deleteVertex(id: ObjectId, vertexId: string): boolean {
    this.#flushObject(id);
    return this.#inner.deleteVertex(id, vertexId);
  }

  setSegment(id: ObjectId, segment: Segment): void {
    this.#flushObject(id);
    this.#inner.setSegment(id, segment);
  }

  deleteSegment(id: ObjectId, segmentId: string): boolean {
    this.#flushObject(id);
    return this.#inner.deleteSegment(id, segmentId);
  }

  /** Writes everything kept, each object and token once. */
  flush(): void {
    for (const object of this.#objects.values()) this.#inner.setObject(object);
    this.#objects.clear();
    for (const { token, creation } of this.#tokens.values()) this.#inner.setToken(token, creation);
    this.#tokens.clear();
  }

  /**
   * Writes what is kept for one object, before an operation on it.
   *
   * @param id - The object.
   */
  #flushObject(id: ObjectId): void {
    const object = this.#objects.get(id);
    if (object === undefined) return;
    this.#objects.delete(id);
    this.#inner.setObject(object);
  }
}

/**
 * A command that runs a single-item command over a list (MCP batch writes): its input is
 * `{ [key]: item[] }`, 1 to {@link MAX_BATCH_ITEMS} items, each parsed by the command's input.
 * The items are planned in order, each against the board with the earlier items' writes (objects
 * and colour tokens, through a `RecordingTransaction`) laid over it, so a later item sees an
 * earlier one; and applied in order in one transaction, one undo step, returning the results in
 * order under `key`. Any item's refusal refuses the whole batch, writing nothing; every item is
 * still judged, and each error's path starts `[key, index]`. An item that creates, deletes or
 * reparents an object is refused (`invalid-input`): the board's reverse indexes do not show the
 * earlier items' structural changes, so such commands are not batched.
 *
 * @param command - The single-item command.
 * @param key - The input's and result's key, plural (`tokens`, `overrides`, ...).
 * @returns The batch command.
 */
export function batchCommand<InputSchema extends z.ZodType, Plan, Result, Key extends string>(
  command: Command<InputSchema, Plan, Result>,
  key: Key,
): Command<
  z.ZodObject<Record<Key, z.ZodArray<InputSchema>>>,
  BatchPlan<z.output<InputSchema>, Plan>,
  Record<Key, Result[]>
> {
  const input = z.strictObject({
    [key]: z
      .array(command.input)
      .min(1)
      .max(MAX_BATCH_ITEMS)
      .describe(`1 to ${String(MAX_BATCH_ITEMS)} items, applied in order as one undo step.`),
  } as Record<Key, z.ZodArray<InputSchema>>);
  return {
    name: `${command.name}Batch`,
    description: `${command.description} Takes many as \`${key}\`, applied in order as one undo step.`,
    input,
    ...(command.isPlacePreserving === true ? { isPlacePreserving: true } : {}),
    validate(context, batch) {
      const items = (batch as Record<Key, z.output<InputSchema>[]>)[key];
      const recorded = new RecordingTransaction(context.board, context.origin);
      const errors: CommandError[] = [];
      const planned: { input: z.output<InputSchema>; plan: Plan }[] = [];
      items.forEach((item, index) => {
        const itemContext: CommandContext = {
          ...context,
          board: overlayOf(context.board, recorded),
        };
        const validation = command.validate(itemContext, item);
        if (!validation.isValid) {
          errors.push(...itemErrors(validation.errors, key, index));
          return;
        }
        const before = new Map(recorded.written);
        command.apply(recorded, item, validation.plan);
        for (const id of restructured(before, recorded.written, context.board)) {
          const message = `${command.name} creates, deletes or reparents objects, which a batch cannot do`;
          errors.push(commandError('invalid-input', id, [key, index], message));
        }
        planned.push({ input: item, plan: validation.plan });
      });
      return errors.length > 0
        ? { isValid: false, errors }
        : { isValid: true, plan: { items: planned } };
    },
    apply(transaction, unused, plan) {
      const coalescing = new CoalescingTransaction(transaction);
      const results = plan.items.map((item) => command.apply(coalescing, item.input, item.plan));
      coalescing.flush();
      return { [key]: results } as Record<Key, Result[]>;
    },
  };
}
