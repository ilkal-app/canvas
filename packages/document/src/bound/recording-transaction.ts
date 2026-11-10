import {
  comparePages,
  DEFAULT_PAGE,
  isBuiltinToken,
  type BoardObject,
  type BoardTimer,
  type ObjectId,
  type Page,
  type PageId,
  type EffectStyleEntry,
  type Segment,
  type StyleId,
  type TextStyleEntry,
  type TokenEntry,
  type TokenId,
  type TokenTable,
  type Vertex,
} from '@canvas/schema';

import type { BoardReader } from '../commands/command.js';
import { restoreMarkerSchema, type RestoreMarker } from '../meta/restore-marker.js';
import type { TransactionOrigin } from '../origin/transaction-origin.js';
import type { DocumentTransaction, ObjectPatch } from '../store/document-store.js';
import type {
  StyleCreation,
  StyleEntry,
  StyleKind,
  StyleTable,
  StyleWrite,
} from '../styles/style-map.js';
import type { TokenCreation, TokenWrite } from '../tokens/token-writes.js';

/** A path's network members, as the recording keeps them. */
type Member = Vertex | Segment;

/**
 * A transaction that writes nothing: it records what a command's `apply` would leave, whole, by
 * id, so the board's bound can judge the result before the real transaction runs, and a
 * caller can see what a command would do (`previewCommand`). Geometry is kept exactly as the store
 * would keep it (a patch merged over the object, a network member set or deleted by id); a text
 * edit changes no geometry and only marks the object written.
 */
export class RecordingTransaction implements DocumentTransaction {
  readonly #board: Pick<
    BoardReader,
    'get' | 'readPages' | 'readTokens' | 'readTextStyles' | 'readEffectStyles' | 'boardTimer'
  >;
  readonly #written = new Map<ObjectId, BoardObject | null>();
  /** The pages as the recorded page writes leave them; `undefined` until one is written. */
  #pages: Map<PageId, Page> | undefined;
  /** The token table as the recorded token writes leave it; `undefined` until one is written. */
  #tokens: Map<TokenId, TokenEntry> | undefined;
  /** Each kind's style table as the recorded style writes leave it. */
  readonly #styles: {
    text?: Map<StyleId, TextStyleEntry>;
    effect?: Map<StyleId, EffectStyleEntry>;
  } = {};
  /** The board timer the recorded timer write leaves; `undefined` until one is written. */
  #timer: { readonly value: BoardTimer | undefined } | undefined;
  readonly #origin: TransactionOrigin;

  /**
   * Starts with nothing written.
   *
   * @param board - The board before the command.
   * @param origin - The origin the command's transaction would carry.
   */
  constructor(
    board: Pick<
      BoardReader,
      'get' | 'readPages' | 'readTokens' | 'readTextStyles' | 'readEffectStyles' | 'boardTimer'
    >,
    origin: TransactionOrigin,
  ) {
    this.#board = board;
    this.#origin = origin;
  }

  /**
   * What was written: each object as it would be, `null` for one deleted.
   *
   * @returns The objects by id.
   */
  get written(): ReadonlyMap<ObjectId, BoardObject | null> {
    return this.#written;
  }

  /** @inheritdoc */
  get origin(): TransactionOrigin {
    return this.#origin;
  }

  /** @inheritdoc */
  markRestore(marker: RestoreMarker): void {
    restoreMarkerSchema.parse(marker);
  }

  /** @inheritdoc */
  get(id: ObjectId): BoardObject | undefined {
    return this.#written.has(id) ? (this.#written.get(id) ?? undefined) : this.#board.get(id);
  }

  /** @inheritdoc */
  setObject(object: BoardObject): void {
    this.#written.set(object.id, object);
  }

  /** @inheritdoc */
  patchObject(id: ObjectId, patch: ObjectPatch): void {
    this.#written.set(id, { ...this.#existing(id), ...patch } as BoardObject);
  }

  /** @inheritdoc */
  pages(): ReadonlyMap<PageId, Page> {
    return this.#pages ?? this.#board.readPages?.() ?? new Map([[DEFAULT_PAGE.id, DEFAULT_PAGE]]);
  }

  /**
   * Records a page write; pages change no geometry.
   *
   * @param page - The page.
   */
  setPage(page: Page): void {
    const pages = new Map(this.pages());
    pages.set(page.id, page);
    this.#pages = new Map([...pages.values()].sort(comparePages).map((each) => [each.id, each]));
  }

  /**
   * Records a page delete.
   *
   * @param pageId - The page.
   * @returns Whether it was there.
   */
  deletePage(pageId: PageId): boolean {
    const pages = new Map(this.pages());
    const isThere = pages.delete(pageId);
    this.#pages = pages;
    return isThere;
  }

  /** @inheritdoc */
  tokens(): TokenTable {
    return this.#tokens ?? this.#board.readTokens?.() ?? new Map();
  }

  /**
   * Records a token write; tokens change no geometry.
   *
   * @param token - The token.
   * @param creation - Who creates it, for a new entry.
   */
  setToken(token: TokenWrite, creation: TokenCreation): void {
    const tokens = new Map(this.tokens());
    const isBuiltin = isBuiltinToken(token.id);
    const existing = tokens.get(token.id);
    tokens.set(token.id, {
      id: token.id,
      name: isBuiltin ? token.id : token.name,
      light: token.light,
      dark: token.dark,
      builtin: isBuiltin,
      createdBy: existing?.createdBy ?? creation.createdBy,
      createdAt: existing?.createdAt ?? creation.createdAt,
    });
    this.#tokens = tokens;
  }

  /**
   * Records a token delete.
   *
   * @param tokenId - The token.
   * @returns Whether it was there.
   */
  deleteToken(tokenId: TokenId): boolean {
    const tokens = new Map(this.tokens());
    const isThere = tokens.delete(tokenId);
    this.#tokens = tokens;
    return isThere;
  }

  /**
   * The board timer as the recorded timer write leaves it, for a batch's next item.
   *
   * @returns The timer, or `undefined` for none.
   */
  boardTimer(): BoardTimer | undefined {
    return this.#timer === undefined ? this.#board.boardTimer?.current : this.#timer.value;
  }

  /**
   * Records a timer write; a timer changes no geometry.
   *
   * @param timer - The timer, or `undefined` for none.
   */
  setBoardTimer(timer: BoardTimer | undefined): void {
    this.#timer = { value: timer };
  }

  /**
   * A sticky author setting write: it changes no object or geometry and no command
   * reads it back, so the recording keeps nothing.
   */
  setStickyAuthors(): void {
    // Nothing to record.
  }

  /**
   * A kind's named styles as the recorded style writes leave them.
   *
   * @param kind - Text or effect styles.
   * @returns The entries by id.
   */
  namedStyles<Kind extends StyleKind>(kind: Kind): StyleTable<Kind> {
    const recorded = this.#styles[kind];
    if (recorded !== undefined) return recorded as StyleTable<Kind>;
    const stored =
      kind === 'text' ? this.#board.readTextStyles?.() : this.#board.readEffectStyles?.();
    return (stored ?? new Map()) as StyleTable<Kind>;
  }

  /**
   * Records a named style write; styles change no geometry (the objects they rewrite are
   * written through `patchObject`).
   *
   * @param kind - Text or effect styles.
   * @param style - The style.
   * @param creation - Who creates it, for a new entry.
   */
  setNamedStyle<Kind extends StyleKind>(
    kind: Kind,
    style: StyleWrite<Kind>,
    creation: StyleCreation,
  ): void {
    const styles = new Map<StyleId, StyleEntry<StyleKind>>(this.namedStyles(kind));
    const existing = styles.get(style.id);
    styles.set(style.id, {
      id: style.id,
      name: style.name,
      value: style.value,
      createdBy: existing?.createdBy ?? creation.createdBy,
      createdAt: existing?.createdAt ?? creation.createdAt,
    } as StyleEntry<StyleKind>);
    this.#keepStyles(kind, styles);
  }

  /**
   * Records a named style delete.
   *
   * @param kind - Text or effect styles.
   * @param styleId - The style.
   * @returns Whether it was there.
   */
  deleteNamedStyle(kind: StyleKind, styleId: StyleId): boolean {
    const styles = new Map<StyleId, StyleEntry<StyleKind>>(this.namedStyles(kind));
    const isThere = styles.delete(styleId);
    this.#keepStyles(kind, styles);
    return isThere;
  }

  /**
   * Keeps a kind's recorded style table.
   *
   * @param kind - Text or effect styles.
   * @param styles - The table.
   */
  #keepStyles(kind: StyleKind, styles: Map<StyleId, StyleEntry<StyleKind>>): void {
    if (kind === 'text') this.#styles.text = styles as Map<StyleId, TextStyleEntry>;
    else this.#styles.effect = styles as Map<StyleId, EffectStyleEntry>;
  }

  /** @inheritdoc */
  deleteObject(id: ObjectId): boolean {
    const isThere = this.get(id) !== undefined;
    this.#written.set(id, null);
    return isThere;
  }

  /**
   * A text edit changes no geometry: the object is only marked written.
   *
   * @param id - The object.
   */
  insertText(id: ObjectId): void {
    this.#touch(id);
  }

  /**
   * A text edit changes no geometry: the object is only marked written.
   *
   * @param id - The object.
   */
  deleteText(id: ObjectId): void {
    this.#touch(id);
  }

  /**
   * A text edit changes no geometry: the object is only marked written.
   *
   * @param id - The object.
   */
  formatText(id: ObjectId): void {
    this.#touch(id);
  }

  /** @inheritdoc */
  setVertex(id: ObjectId, vertex: Vertex): void {
    this.#setMember(id, 'vertices', vertex);
  }

  /** @inheritdoc */
  deleteVertex(id: ObjectId, vertexId: string): boolean {
    return this.#deleteMember(id, 'vertices', vertexId);
  }

  /** @inheritdoc */
  setSegment(id: ObjectId, segment: Segment): void {
    this.#setMember(id, 'segments', segment);
  }

  /** @inheritdoc */
  deleteSegment(id: ObjectId, segmentId: string): boolean {
    return this.#deleteMember(id, 'segments', segmentId);
  }

  /**
   * An object that must be there, as it is now.
   *
   * @param id - The object.
   * @returns It.
   * @throws {RangeError} When there is no such object, as the store's write would.
   */
  #existing(id: ObjectId): BoardObject {
    const object = this.get(id);
    if (object === undefined) throw new RangeError(`There is no object "${id}" to write`);
    return object;
  }

  /**
   * Marks an object written without changing it.
   *
   * @param id - The object.
   */
  #touch(id: ObjectId): void {
    this.#written.set(id, this.#existing(id));
  }

  /**
   * The members of one of a path's network lists.
   *
   * @param id - The path.
   * @param list - `vertices` or `segments`.
   * @returns The path and the list.
   * @throws {RangeError} When there is no such object, or it has no such list.
   */
  #members(id: ObjectId, list: 'vertices' | 'segments'): [BoardObject, readonly Member[]] {
    const object = this.#existing(id);
    const members = (object as unknown as Readonly<Record<string, unknown>>)[list];
    if (!Array.isArray(members)) throw new RangeError(`"${id}" has no ${list}`);
    return [object, members as readonly Member[]];
  }

  /**
   * Sets a network member by id: replaced where it is, or added at the end.
   *
   * @param id - The path.
   * @param list - `vertices` or `segments`.
   * @param member - The member.
   */
  #setMember(id: ObjectId, list: 'vertices' | 'segments', member: Member): void {
    const [object, members] = this.#members(id, list);
    const isThere = members.some(({ id: key }) => key === member.id);
    const next = isThere
      ? members.map((existing) => (existing.id === member.id ? member : existing))
      : [...members, member];
    this.#written.set(id, { ...object, [list]: next });
  }

  /**
   * Deletes a network member by id.
   *
   * @param id - The path.
   * @param list - `vertices` or `segments`.
   * @param memberId - The member's id.
   * @returns Whether it was there.
   */
  #deleteMember(id: ObjectId, list: 'vertices' | 'segments', memberId: string): boolean {
    const [object, members] = this.#members(id, list);
    const next = members.filter(({ id: key }) => key !== memberId);
    this.#written.set(id, { ...object, [list]: next });
    return next.length < members.length;
  }
}
