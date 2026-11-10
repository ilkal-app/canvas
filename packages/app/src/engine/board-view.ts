import type { BoardReader, ChangeSet } from '@canvas/document';
import type { WorldBounds } from '@canvas/engine';
import type { ObjectId, Point, TokenTable } from '@canvas/schema';

import type { DeletionConfirmationSource } from './deletion-confirmations.js';

/** What the board looks like to the panels at one moment. */
export interface BoardViewState {
  /** Increases by one with every change set the document delivers, starting at 0. */
  readonly documentVersion: number;
  /** The selected ids, primary first: the same array until the selection changes. */
  readonly selectedIds: readonly ObjectId[];
  /** The group the select tool entered with a double press, or null at the top level. */
  readonly enteredGroupId: ObjectId | null;
}

/** What changed, as a {@link BoardView} tells its listeners. */
export type BoardViewChange =
  | {
      /** A transaction changed the document (anyone's, local or remote). */
      readonly kind: 'document';
      /** What it changed. */
      readonly changes: ChangeSet;
    }
  | {
      /** The selection changed, or the group entered. */
      readonly kind: 'selection';
    };

/**
 * The board as the shell's panels see it: the document to read, the
 * selection, a way to select from a panel, and a change feed. The engine's document side
 * provides it on the page, whichever thread renders; drag previews are not reported (the
 * document does not change until the gesture's command runs). Main thread.
 */
export interface BoardView {
  /** The document, read-only: objects one at a time and the reverse indexes. */
  readonly board: BoardReader;
  /**
   * The whole board across pages, read-only, where `board` shows one page: an instance's main
   * and its content may be on another page. `board` when absent.
   */
  readonly definitions?: BoardReader;
  /**
   * Calls `listener` after each change set of the whole board, on any page, where `board`
   * shows one page and its feed (`subscribe`) tells only that page's changes.
   * Absent where the view has no whole board apart.
   *
   * @param listener - Receives the change set.
   * @returns A function that unsubscribes.
   */
  subscribeDefinitions?(listener: (changes: ChangeSet) => void): () => void;
  /**
   * The board's colour token table now: its custom tokens and edited built-ins, by id;
   * the built-ins at their defaults are not in it. Absent where the view has no tokens (the
   * built-in defaults apply).
   *
   * @returns The table.
   */
  tokens?(): TokenTable;
  /**
   * Calls `listener` after each change set of the whole board that changes a colour token
   * (`ChangeSet.tokens`), on any page. Absent with {@link BoardView.tokens}.
   *
   * @param listener - Called after the change.
   * @returns A function that unsubscribes.
   */
  subscribeTokens?(listener: () => void): () => void;
  /**
   * The person's deletion waiting for their answer, which the shell's dialog asks about
   * (ruling 6); deletions never wait when absent.
   */
  readonly deletions?: DeletionConfirmationSource | undefined;
  /**
   * The document version and the selection now; the same object until either changes, so it
   * can be a `useSyncExternalStore` snapshot.
   *
   * @returns The state.
   */
  state(): BoardViewState;
  /**
   * Selects exactly these ids, as a click on the canvas would (a layers panel row).
   *
   * @param ids - The ids, primary first.
   */
  select(ids: readonly ObjectId[]): void;
  /**
   * Calls `listener` after each document change set and each selection change.
   *
   * @param listener - Receives what changed.
   * @returns A function that unsubscribes.
   */
  subscribe(listener: (change: BoardViewChange) => void): () => void;
  /**
   * Whether the person's gesture under way (a drag, resize or rotate the select tool previews)
   * shows this object somewhere other than the document has it (its comment pins hide
   * until the drop). Absent where nothing previews.
   *
   * @param id - The object.
   * @returns True while the gesture moves, resizes or rotates it.
   */
  isMoving?(id: ObjectId): boolean;
  /**
   * Calls `callback` once no stepped run holds the board, at once when none does, so
   * a panel follows a run's parts in one pass at its end, not a pass per part: a page switch
   * announces its page a slice per task. Never calls it when the board is destroyed
   * during the run. Absent where nothing runs in steps: the panel follows at once.
   *
   * @param callback - What to run.
   */
  whenIdle?(callback: () => void): void;
  /**
   * The objects on the page shown whose drawn bounds meet a world rectangle, with those bounds,
   * from the spatial index (the selection's popover covers as little of the board as
   * it can). Absent where the view has no index.
   *
   * @param bounds - The rectangle, in world units.
   * @returns Each object met and its bounds, in no particular order.
   */
  objectsIn?(bounds: WorldBounds): readonly {
    /** The object. */
    readonly id: ObjectId;
    /** Its drawn bounds, in world units. */
    readonly bounds: WorldBounds;
  }[];
  /**
   * An object's drawn bounds from the spatial index, a connector placed on its targets (
   * the selection popover beside a connector). Absent where the view has no index.
   *
   * @param id - The object.
   * @returns Its bounds, in world units, or undefined.
   */
  boundsOf?(id: ObjectId): WorldBounds | undefined;
  /**
   * The objects drawn under a world point, topmost first, by their exact geometry (the
   * link a ⌘-click opens). Absent where the view has no index.
   *
   * @param point - The point, in world units.
   * @param zoom - The camera zoom.
   * @returns The ids, topmost first.
   */
  idsAt?(point: Point, zoom: number): readonly ObjectId[];
}

/** What answers {@link BoardView.objectsIn}: the document's hit index. */
export interface ObjectSearch {
  /**
   * The objects whose drawn bounds meet a world rectangle, with those bounds.
   *
   * @param bounds - The rectangle, in world units.
   * @returns Each object met and its bounds.
   */
  objectsIn(bounds: WorldBounds): readonly IndexedObject[];
  /**
   * An object's drawn bounds, a connector placed on its targets.
   *
   * @param id - The object.
   * @returns Its bounds, or undefined.
   */
  boundsOf?(id: ObjectId): WorldBounds | undefined;
  /**
   * The objects drawn under a world point, topmost first.
   *
   * @param point - The point, in world units.
   * @param zoom - The camera zoom.
   * @returns The ids, topmost first.
   */
  idsAt?(point: Point, zoom: number): readonly ObjectId[];
}

/** An object the spatial index holds, and its drawn bounds in world units. */
export interface IndexedObject {
  /** The object. */
  readonly id: ObjectId;
  /** Its drawn bounds. */
  readonly bounds: WorldBounds;
}
