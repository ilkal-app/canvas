import type {
  DocumentTransaction,
  ObjectPatch,
  PageCreation,
  StyleCreation,
  StyleKind,
  StyleTable,
  StyleWrite,
  TextStylePatch,
  TokenCreation,
  TokenWrite,
  TransactionOrigin,
} from '@canvas/document';
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

/**
 * A transaction of the whole board written from one page (`PageScopedStore`): every write goes
 * through as it is, except that a new root object given no page goes on the page shown, where
 * the person made it. Works only while its transaction runs.
 */
export class PageTransaction implements DocumentTransaction {
  readonly #inner: DocumentTransaction;
  readonly #page: PageId;

  /**
   * Wraps a transaction.
   *
   * @param inner - The whole board's transaction.
   * @param page - The page shown.
   */
  constructor(inner: DocumentTransaction, page: PageId) {
    this.#inner = inner;
    this.#page = page;
  }

  /** @inheritdoc */
  get origin(): TransactionOrigin {
    return this.#inner.origin;
  }

  /** @inheritdoc */
  markRestore(...args: Parameters<DocumentTransaction['markRestore']>): void {
    this.#inner.markRestore(...args);
  }

  /** @inheritdoc */
  get(id: ObjectId): BoardObject | undefined {
    return this.#inner.get(id);
  }

  /** @inheritdoc */
  setObject(object: BoardObject): void {
    const isNewRoot =
      object.parentId === null &&
      (object.pageId === undefined || object.pageId === null) &&
      this.#inner.get(object.id) === undefined;
    this.#inner.setObject(isNewRoot ? { ...object, pageId: this.#page } : object);
  }

  /** @inheritdoc */
  patchObject(id: ObjectId, patch: ObjectPatch): void {
    this.#inner.patchObject(id, patch);
  }

  /** @inheritdoc */
  pages(): ReadonlyMap<PageId, Page> {
    return this.#inner.pages();
  }

  /** @inheritdoc */
  setPage(page: Page, creation: PageCreation): void {
    this.#inner.setPage(page, creation);
  }

  /** @inheritdoc */
  deletePage(pageId: PageId): boolean {
    return this.#inner.deletePage(pageId);
  }

  /** @inheritdoc */
  tokens(): TokenTable {
    return this.#inner.tokens();
  }

  /** @inheritdoc */
  setToken(token: TokenWrite, creation: TokenCreation): void {
    this.#inner.setToken(token, creation);
  }

  /** @inheritdoc */
  deleteToken(tokenId: TokenId): boolean {
    return this.#inner.deleteToken(tokenId);
  }

  /** @inheritdoc */
  setBoardTimer(timer: BoardTimer | undefined): void {
    this.#inner.setBoardTimer(timer);
  }

  /** @inheritdoc */
  setStickyAuthors(isShown: boolean): void {
    this.#inner.setStickyAuthors(isShown);
  }

  /** @inheritdoc */
  namedStyles<Kind extends StyleKind>(kind: Kind): StyleTable<Kind> {
    return this.#inner.namedStyles(kind);
  }

  /** @inheritdoc */
  setNamedStyle<Kind extends StyleKind>(
    kind: Kind,
    style: StyleWrite<Kind>,
    creation: StyleCreation,
  ): void {
    this.#inner.setNamedStyle(kind, style, creation);
  }

  /** @inheritdoc */
  deleteNamedStyle(kind: StyleKind, styleId: StyleId): boolean {
    return this.#inner.deleteNamedStyle(kind, styleId);
  }

  /** @inheritdoc */
  deleteObject(id: ObjectId): boolean {
    return this.#inner.deleteObject(id);
  }

  /** @inheritdoc */
  insertText(id: ObjectId, index: number, text: string, style: TextStyle): void {
    this.#inner.insertText(id, index, text, style);
  }

  /** @inheritdoc */
  deleteText(id: ObjectId, index: number, length: number): void {
    this.#inner.deleteText(id, index, length);
  }

  /** @inheritdoc */
  formatText(id: ObjectId, index: number, length: number, patch: TextStylePatch): void {
    this.#inner.formatText(id, index, length, patch);
  }

  /** @inheritdoc */
  setVertex(id: ObjectId, vertex: Vertex): void {
    this.#inner.setVertex(id, vertex);
  }

  /** @inheritdoc */
  deleteVertex(id: ObjectId, vertexId: string): boolean {
    return this.#inner.deleteVertex(id, vertexId);
  }

  /** @inheritdoc */
  setSegment(id: ObjectId, segment: Segment): void {
    this.#inner.setSegment(id, segment);
  }

  /** @inheritdoc */
  deleteSegment(id: ObjectId, segmentId: string): boolean {
    return this.#inner.deleteSegment(id, segmentId);
  }
}
