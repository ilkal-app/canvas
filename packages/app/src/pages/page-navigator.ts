import {
  isOwnedBy,
  isStoreRunning,
  runCommand,
  whenStoreIdle,
  type ChangeSet,
  type CommandError,
  type CommandEnvironment,
  type DocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import { firstPageIdOf, type ObjectId, type Page, type PageId } from '@canvas/schema';

import { BUSY_NOTICE } from '../notices/busy-notices.js';

import type { PageMove } from './page-index.js';
import type { PageScopedStore } from './page-scoped-store.js';
import type { PageSlicing } from './sliced-page-switch.js';

/** The page commands the page list runs, by registered name. */
export type PageCommandName =
  'addPage' | 'renamePage' | 'reorderPage' | 'duplicatePage' | 'deletePage' | 'moveObjectsToPage';

/** What a page list reads and does: the pages, the page shown, the page commands. */
export interface PageNavigation {
  /**
   * The board's live pages, in order.
   *
   * @returns The pages; never empty.
   */
  pages(): readonly Page[];
  /**
   * The page shown.
   *
   * @returns Its id.
   */
  current(): PageId;
  /**
   * How many objects a page holds, for the delete confirmation.
   *
   * @param pageId - The page.
   * @returns The count, descendants included.
   */
  objectCount(pageId: PageId): number;
  /**
   * Shows a page; a page that is not live is ignored.
   *
   * @param pageId - The page.
   */
  show(pageId: PageId): void;
  /**
   * Shows the page before or after the one shown, if there is one.
   *
   * @param step - -1 for the previous page, 1 for the next.
   */
  step(step: -1 | 1): void;
  /**
   * Runs a page command over the whole board as the person (one undo step).
   *
   * @param name - The command.
   * @param input - Its input.
   * @returns Its result, or `undefined` when it was refused (the person is told).
   */
  run(name: PageCommandName, input: unknown): unknown;
  /**
   * Listens for a switch and for changes of the pages.
   *
   * @param listener - Called after each.
   * @returns A function that stops listening.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Listens for the person's own edits of the board, each a step their undo history records: a
   * transaction made here that their history owns (`isOwnedBy`: theirs and their operated
   * agents'), not a collaborator's change or an undo.
   * The whiteboard's page deletion notice drops its Undo at the first one.
   *
   * @param listener - Called after each.
   * @returns A function that stops listening.
   */
  subscribeEdits?(listener: () => void): () => void;
  /**
   * When the page shown has been announced in full: a sliced switch tells
   * listeners of its page after the first slice, the rest a task each.
   *
   * @returns Resolves once the page's last slice is out; `undefined` when none is owed.
   */
  whenShown?(): Promise<void> | undefined;
}

/** What a {@link PageNavigator} runs commands with and tells. */
export interface PageNavigatorOptions {
  /** The whole board. */
  readonly store: DocumentStore;
  /** The board as shown on one page. */
  readonly view: PageScopedStore;
  /** Who the commands are attributed to. */
  readonly origin: TransactionOrigin;
  /** The clock and id generator. */
  readonly environment: CommandEnvironment;
  /** The registry's commands, by name (`findCommand`). */
  readonly findCommand: (name: string) => Parameters<typeof runCommand>[2] | undefined;
  /** Hears a refusal. */
  readonly onRefused?: (errors: readonly CommandError[]) => void;
  /** Shows the person a notice: a page command refused while a change is applied. */
  readonly onNotice?: (message: string) => void;
  /** Called before the page shown changes: the selection clears, an edit under way ends. */
  readonly beforeSwitch?: (from: PageId, to: PageId) => void;
  /**
   * Spreads a switch's announcement over browser tasks (`PageScopedStore.showInSlices`,
   *); absent, a switch is one change set, as in tests and tools.
   */
  readonly slicing?: PageSlicing;
}

/**
 * The page list's model: which page is shown, per person and not synced; showing another
 * page through the page-scoped store; the first page when the page shown is deleted (by anyone);
 * the page of an undo or redo whose change is on another page (the step applies
 * and the person is taken to it); and the page commands, run over the whole board. Main thread.
 */
export class PageNavigator implements PageNavigation {
  readonly #options: PageNavigatorOptions;
  readonly #listeners = new Set<() => void>();
  readonly #stop: () => void;
  /** The page a switch asked for during a stepped run, shown once the store is idle. */
  #wanted: PageId | undefined;
  #showing: Promise<void> | undefined;

  /**
   * Starts following the board.
   *
   * @param options - The board, its page view, the command environment and the callbacks.
   */
  constructor(options: PageNavigatorOptions) {
    this.#options = options;
    this.#stop = options.view.subscribeBoard((changes, moves, pageOf) => {
      this.#follow(changes, moves, pageOf);
    });
  }

  /** @inheritdoc */
  subscribeEdits(listener: () => void): () => void {
    const { store, origin } = this.#options;
    // The history of the person the navigator acts for, by the rule it records by (`isOwnedBy`):
    // their own changes and those of agents they operate, under the same history key.
    const owner =
      origin.kind === 'agent' ? (origin.operatorId ?? origin.principalId) : origin.principalId;
    return store.subscribeUpdates((update) => {
      if (update.isLocal && isOwnedBy(update.origin, owner, origin.historyKey)) listener();
    });
  }

  /** @inheritdoc */
  pages(): readonly Page[] {
    return [...this.#options.store.readPages().values()];
  }

  /** @inheritdoc */
  current(): PageId {
    return this.#options.view.page;
  }

  /** @inheritdoc */
  objectCount(pageId: PageId): number {
    return this.#options.view.countOn(pageId);
  }

  /**
   * Shows a page the person asked for; while a stepped run holds the store, once it is idle,
   * the latest request only, and nothing when that page is gone by then.
   *
   * @param pageId - The page.
   */
  show(pageId: PageId): void {
    this.#wanted = pageId;
    whenStoreIdle(this.#options.store, () => {
      if (this.#wanted !== pageId) return;
      this.#wanted = undefined;
      this.#show(pageId);
    });
  }

  /**
   * Shows a page now: the person's switch, or the navigator following the board.
   *
   * @param pageId - The page.
   * @param isUserSwitch - False when following the board, inside the store's change notification,
   *   where a sliced switch may not open a store run.
   */
  #show(pageId: PageId, isUserSwitch = true): void {
    const { view, store } = this.#options;
    if (pageId === view.page || !store.readPages().has(pageId)) return;
    this.#options.beforeSwitch?.(view.page, pageId);
    const { slicing } = this.#options;
    if (slicing === undefined) view.show(pageId);
    // The page shows at once; its later slices go out a task each under a store run, which holds
    // input and further switches. A failed yield leaves the rest unannounced until the next
    // switch, which is all a later slice could do.
    else {
      const showing = view.showInSlices(pageId, slicing, isUserSwitch).catch(() => undefined);
      this.#showing = showing;
      void showing.then(() => {
        if (this.#showing === showing) this.#showing = undefined;
      });
    }
    this.#notify();
  }

  /** @inheritdoc */
  step(step: -1 | 1): void {
    const pages = this.pages();
    const index = pages.findIndex(({ id }) => id === this.current());
    const next = pages[index + step];
    if (next !== undefined) this.show(next.id);
  }

  /** @inheritdoc */
  run(name: PageCommandName, input: unknown): unknown {
    const command = this.#options.findCommand(name);
    if (command === undefined) return undefined;
    const { store, origin, environment } = this.#options;
    if (isStoreRunning(store)) {
      this.#options.onNotice?.(BUSY_NOTICE);
      return undefined;
    }
    const outcome = runCommand(store, origin, command, input as never, environment);
    if (outcome.status === 'rejected') {
      this.#options.onRefused?.(outcome.errors);
      return undefined;
    }
    return outcome.result;
  }

  /** @inheritdoc */
  whenShown(): Promise<void> | undefined {
    return this.#showing;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Stops following the board. */
  destroy(): void {
    this.#stop();
    this.#listeners.clear();
  }

  /**
   * Follows a change of the board: the page shown deleted, an undo on another page, a change of
   * the pages.
   *
   * @param changes - The change set.
   * @param moves - The objects whose page changed, came or went.
   * @param pageOf - The page index now.
   */
  #follow(
    changes: ChangeSet,
    moves: ReadonlyMap<ObjectId, PageMove>,
    pageOf: (id: ObjectId) => PageId | undefined,
  ): void {
    const pages = this.#options.store.readPages();
    if (!pages.has(this.current())) {
      // Following the board is immediate, even during a run: the page shown is gone.
      this.#show(firstPageIdOf({ objects: new Map(), pages }), false);
      return;
    }
    if (changes.isLocal && changes.origin.kind === 'undo') {
      const shown = this.#shownPages(changes, moves, pageOf);
      const target = [...pages.keys()].find((id) => shown.has(id));
      if (target !== undefined && !shown.has(this.current())) {
        this.#show(target, false);
        return;
      }
    }
    if (changes.pages !== undefined) this.#notify();
  }

  /**
   * The pages where an undo or redo is seen: where the objects it leaves on
   * the board are now, so undoing or redoing a move to another page shows the page the objects
   * land on, and the pages whose keys it wrote. A change that leaves nothing (a deletion) is seen
   * where its objects were.
   *
   * @param changes - The change set.
   * @param moves - The objects whose page changed, came or went.
   * @param pageOf - The page index now.
   * @returns The pages.
   */
  #shownPages(
    changes: ChangeSet,
    moves: ReadonlyMap<ObjectId, PageMove>,
    pageOf: (id: ObjectId) => PageId | undefined,
  ): Set<PageId> {
    const landed = new Set<PageId>(changes.pages ?? []);
    const left = new Set<PageId>();
    for (const id of [...changes.created, ...changes.updated, ...changes.deleted]) {
      const now = pageOf(id);
      if (now !== undefined) landed.add(now);
      const before = moves.get(id)?.before;
      if (before !== undefined) left.add(before);
    }
    return landed.size > 0 ? landed : left;
  }

  /** Tells the listeners. */
  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}

/**
 * The name a collaborator's page shows under (the presence bar): its name while the board
 * has more than one page, since on a board of one page everyone is on it and saying so is noise.
 *
 * @param navigation - The pages, or undefined before an engine mounts.
 * @param pageId - The page a collaborator's presence names.
 * @returns The page's name, or undefined for a board of one page or a page it does not hold.
 */
export function collaboratorPageName(
  navigation: Pick<PageNavigation, 'pages'> | undefined,
  pageId: string,
): string | undefined {
  const pages = navigation?.pages() ?? [];
  return pages.length < 2 ? undefined : pages.find(({ id }) => id === pageId)?.name;
}
