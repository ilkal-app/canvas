import {
  whenStoreIdle,
  type BoardReader,
  type ChangeSet,
  type DocumentStore,
} from '@canvas/document';
import type { WorldBounds } from '@canvas/engine';
import type { BoardObject, ObjectId, Point, TokenTable } from '@canvas/schema';

import type {
  BoardView,
  BoardViewChange,
  BoardViewState,
  IndexedObject,
  ObjectSearch,
} from './board-view.js';
import type { DeletionConfirmationSource } from './deletion-confirmations.js';
import { hasSamePlace } from './object-place.js';

/** The selection before the first report: nothing selected. */
const NO_IDS: readonly ObjectId[] = [];

/** The selection a {@link DocumentBoardView} reports: the select tool's. */
export interface BoardViewSelection {
  /**
   * The selected ids now, primary first; a new array only when the selection changes.
   *
   * @returns The ids.
   */
  ids(): readonly ObjectId[];
  /**
   * Selects exactly these ids.
   *
   * @param ids - The ids, primary first.
   */
  select(ids: readonly ObjectId[]): void;
  /**
   * The group the select tool entered, if the selection has one.
   *
   * @returns Its id, or null at the board's top level.
   */
  enteredGroupId?(): ObjectId | null;
  /**
   * An object as the select tool shows it: its gesture's preview, else the document's.
   *
   * @param id - The object.
   * @returns The object shown, if any.
   */
  shown?(id: ObjectId): BoardObject | undefined;
}

/**
 * A {@link BoardView} over a document and the select tool's selection: it follows the store's
 * change sets itself and is told when the selection may have changed
 * ({@link DocumentBoardView.selectionChanged}), reporting only real changes. Main thread.
 */
export class DocumentBoardView implements BoardView {
  readonly board: BoardReader;
  readonly definitions: BoardReader;
  readonly deletions: DeletionConfirmationSource | undefined;
  private readonly wholeBoard: DocumentStore;
  private readonly selection: BoardViewSelection;
  private readonly search: ObjectSearch | undefined;
  private readonly listeners = new Set<(change: BoardViewChange) => void>();
  private readonly stopListening: () => void;
  private current: BoardViewState;

  /**
   * Starts following the document, with nothing selected until told otherwise
   * ({@link DocumentBoardView.selectionChanged}); the selection is not read here, so it may be
   * made after this view.
   *
   * @param store - The document.
   * @param selection - The selection to report and change.
   * @param extras - The whole board when `store` shows one page, and the deletions waiting for
   *   the person's answer; `store` and none when absent.
   * @param extras.definitions - The whole board.
   * @param extras.deletions - The deletions waiting.
   * @param extras.search - The hit index, which answers {@link BoardView.objectsIn}.
   */
  constructor(
    store: DocumentStore,
    selection: BoardViewSelection,
    extras: {
      readonly definitions?: DocumentStore | undefined;
      readonly deletions?: DeletionConfirmationSource;
      readonly search?: ObjectSearch | undefined;
    } = {},
  ) {
    this.board = store;
    this.definitions = extras.definitions ?? store;
    this.wholeBoard = extras.definitions ?? store;
    this.deletions = extras.deletions;
    this.selection = selection;
    this.search = extras.search;
    this.current = { documentVersion: 0, selectedIds: NO_IDS, enteredGroupId: null };
    this.stopListening = store.subscribe((changes) => {
      this.current = { ...this.current, documentVersion: this.current.documentVersion + 1 };
      this.notify({ kind: 'document', changes });
    });
  }

  state(): BoardViewState {
    return this.current;
  }

  select(ids: readonly ObjectId[]): void {
    this.selection.select(ids);
    this.selectionChanged();
  }

  whenIdle(callback: () => void): void {
    whenStoreIdle(this.wholeBoard, callback);
  }

  isMoving(id: ObjectId): boolean {
    const shown = this.selection.shown?.(id);
    const stored = this.board.get(id);
    return shown !== undefined && stored !== undefined && !hasSamePlace(shown, stored);
  }

  objectsIn(bounds: WorldBounds): readonly IndexedObject[] {
    return this.search?.objectsIn(bounds) ?? [];
  }

  /**
   * An object's drawn bounds from the hit index, a connector placed on its targets.
   *
   * @param id - The object.
   * @returns Its bounds, or undefined without an index.
   */
  boundsOf(id: ObjectId): WorldBounds | undefined {
    return this.search?.boundsOf?.(id);
  }

  /**
   * The objects drawn under a world point, topmost first, from the hit index.
   *
   * @param point - The point, in world units.
   * @param zoom - The camera zoom.
   * @returns The ids, topmost first; none without an index.
   */
  idsAt(point: Point, zoom: number): readonly ObjectId[] {
    return this.search?.idsAt?.(point, zoom) ?? [];
  }

  subscribeDefinitions(listener: (changes: ChangeSet) => void): () => void {
    return this.wholeBoard.subscribe(listener);
  }

  tokens(): TokenTable {
    return this.wholeBoard.readTokens();
  }

  subscribeTokens(listener: () => void): () => void {
    return this.wholeBoard.subscribe((changes) => {
      if ((changes.tokens?.length ?? 0) > 0) listener();
    });
  }

  subscribe(listener: (change: BoardViewChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Reports the selection and the entered group to the listeners if either changed since last
   * reported (an empty selection is the same as the one before the first report).
   */
  selectionChanged(): void {
    const ids = this.selection.ids();
    const enteredGroupId = this.selection.enteredGroupId?.() ?? null;
    const isSameEntered = enteredGroupId === this.current.enteredGroupId;
    const isSameIds =
      ids === this.current.selectedIds ||
      (ids.length === 0 && this.current.selectedIds.length === 0);
    if (isSameIds && isSameEntered) return;
    const selectedIds = isSameIds ? this.current.selectedIds : ids;
    this.current = { ...this.current, selectedIds, enteredGroupId };
    this.notify({ kind: 'selection' });
  }

  /** Stops following the document and drops the listeners. */
  destroy(): void {
    this.stopListening();
    this.listeners.clear();
  }

  private notify(change: BoardViewChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
}
