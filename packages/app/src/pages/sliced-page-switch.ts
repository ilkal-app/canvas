// A page switch spread over browser tasks: the objects of the page shown next,
// announced a slice per task, parents first, so no task does a whole page's listener work. The
// page-scoped store owns one while it slices and routes its changes through it.
import {
  isStoreRunning,
  type DocumentStore,
  type RunnableStore,
  type StoreRun,
} from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

/** How a page switch is spread over browser tasks. */
export interface PageSlicing {
  /** The most objects one task announces. */
  readonly sliceSize: number;
  /**
   * The most objects the first task announces, beside the page left's deletes, which cost that
   * task most of its time; absent, `sliceSize`.
   */
  readonly firstSliceSize?: number;
  /** Ends the task, so the browser can draw and take input before the next slice. */
  readonly yieldToBrowser: () => Promise<void>;
  /**
   * Called after each slice is announced, to send it to the renderer at once (`HostView.flush`)
   * rather than at the next animation frame, which the slices' tasks hold back, as a
   * sliced attach does (`SceneAttachSlicing.afterSlice`).
   */
  readonly afterSlice?: () => void;
}

/**
 * A page's objects in the order a sliced switch announces them: by depth on the page, then id,
 * so a parent on the page always comes before its children. O(objects × depth) at worst, each
 * depth read once.
 *
 * @param ids - The page's objects.
 * @param parentOf - An object's parent, if it has one on the page.
 * @returns Them, parents first.
 */
export function parentsFirst(
  ids: readonly ObjectId[],
  parentOf: (id: ObjectId) => ObjectId | null,
): ObjectId[] {
  const depths = new Map<ObjectId, number>();
  const depthOf = (id: ObjectId, seen: Set<ObjectId>): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    const parentId = parentOf(id);
    seen.add(id);
    // A parent cycle (which the door refuses, but a peer could store) ends the walk.
    const depth = parentId === null || seen.has(parentId) ? 0 : depthOf(parentId, seen) + 1;
    depths.set(id, depth);
    return depth;
  };
  for (const id of ids) depthOf(id, new Set());
  return [...ids].sort(
    (a, b) => (depths.get(a) ?? 0) - (depths.get(b) ?? 0) || (a < b ? -1 : a > b ? 1 : 0),
  );
}

/** What a sliced switch starts from. */
export interface SlicedSwitchStart {
  /** The store it holds a run on, unless one is open already (an undo's). */
  readonly store: DocumentStore;
  /**
   * Whether it may open a run: not inside the store's change notification (an undo's switch to
   * its page), where no run may begin; its slices then go out without holding input.
   */
  readonly canOpenRun: boolean;
  /** The new page's objects, parents first (`parentsFirst`). */
  readonly order: readonly ObjectId[];
  /** The slice size and how to end a task. */
  readonly slicing: PageSlicing;
  /** The objects of the page left that listeners were told of: the first change deletes them. */
  readonly deleted: readonly ObjectId[];
  /** Tells listeners of a slice and, in the first, of the deleted objects. */
  readonly announce: (created: readonly ObjectId[], deleted: readonly ObjectId[]) => void;
  /** Takes the switch before its first announcement, so readers already see what it owes. */
  readonly adopt: (sliced: SlicedPageSwitch) => void;
}

/** One sliced switch under way: what it still owes, and the run it holds. */
export class SlicedPageSwitch {
  /** Resolves when every object is announced or it stopped; rejects when a task cannot end. */
  readonly done: Promise<void>;
  /** The ids not announced yet: a change on one announces it, or drops it. */
  readonly owed: Set<ObjectId>;
  readonly #order: readonly ObjectId[];
  #next = 0;
  #run: StoreRun | undefined;
  #isStopped = false;

  /**
   * Starts a switch: opens a run on the store unless one is open, then announces the deleted
   * objects with the first slice synchronously, and the rest a slice per task.
   *
   * @param start - The store, the order, the slicing, the deleted objects and the announcer.
   * @throws {unknown} Whatever the first announcement's listeners throw, after closing the run.
   */
  constructor(start: SlicedSwitchStart) {
    const { store, canOpenRun, order, slicing, deleted, announce, adopt } = start;
    this.#order = order;
    this.owed = new Set(order);
    const runnable = store as DocumentStore & Partial<RunnableStore>;
    this.#run = !canOpenRun || isStoreRunning(store) ? undefined : runnable.beginRun?.();
    try {
      adopt(this);
      announce(this.take(slicing.firstSliceSize ?? slicing.sliceSize), deleted);
      slicing.afterSlice?.();
    } catch (error) {
      this.stop();
      throw error;
    }
    this.done = this.#announceRest(slicing, (created) => {
      announce(created, []);
    });
  }

  /**
   * Stops a switch, if any, and keeps the ids listeners were told of: a switch away deletes
   * only those, never the objects it still owed.
   *
   * @param sliced - The switch under way, if any.
   * @param ids - The objects of the page it was showing.
   * @returns The announced ones, sorted.
   */
  static announced(sliced: SlicedPageSwitch | undefined, ids: readonly ObjectId[]): ObjectId[] {
    sliced?.stop();
    return (sliced === undefined ? [...ids] : ids.filter((id) => !sliced.owed.has(id))).sort();
  }

  /**
   * Takes the next slice of the owed objects, skipping those a change already announced or
   * dropped, and reports the run's progress.
   *
   * @param size - The slice's most objects.
   * @returns The slice, in order.
   */
  take(size: number): ObjectId[] {
    const slice: ObjectId[] = [];
    while (slice.length < size && this.#next < this.#order.length) {
      const id = this.#order[this.#next];
      this.#next += 1;
      if (id !== undefined && this.owed.delete(id)) slice.push(id);
    }
    const total = this.#order.length;
    this.#run?.progress(total - this.owed.size, total);
    return slice;
  }

  /**
   * Announces the slices after the first, one per task, until none is owed or it stops; then
   * stops (closing its run) whatever happens.
   *
   * @param slicing - The slice size and how to end a task.
   * @param announce - Tells listeners of a slice.
   * @returns Resolves when done or stopped; rejects when ending a task fails.
   */
  async #announceRest(
    slicing: PageSlicing,
    announce: (created: readonly ObjectId[]) => void,
  ): Promise<void> {
    try {
      while (!this.#isStopped && this.owed.size > 0) {
        await slicing.yieldToBrowser();
        // Stopped meanwhile: superseded or destroyed (read through a call, after the await).
        if (this.#hasStopped()) return;
        const created = this.take(slicing.sliceSize);
        if (created.length > 0) {
          announce(created);
          slicing.afterSlice?.();
        }
      }
    } finally {
      this.stop();
    }
  }

  /**
   * Whether it is stopped, read through a call so a stop during an await is seen.
   *
   * @returns True once stopped.
   */
  #hasStopped(): boolean {
    return this.#isStopped;
  }

  /** Stops it: no further slices, and its run closed. */
  stop(): void {
    this.#isStopped = true;
    this.#run?.close();
    this.#run = undefined;
  }
}
