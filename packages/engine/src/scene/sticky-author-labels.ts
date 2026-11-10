import type { BoardObject, ObjectId } from '@canvas/schema';

import {
  NO_STICKY_AUTHORS,
  STICKY_AUTHOR_LABEL,
  stickyAuthorTextOf,
  type LabelledObject,
  type StickyAuthors,
} from '../text/scene/sticky-author-box.js';

import { isRootMoveChanges, markRootMoveChanges } from './root-move-changes.js';
import type { SceneChangeSet } from './scene-source.js';

/**
 * The board's sticky author labels as the scene reads them: every change set the
 * renderer queues hands the passes each sticky with its label resolved (`STICKY_AUTHOR_LABEL`,
 * read by the sticky author pass), and new authors queue just the stickies whose label changed.
 * Keeps the stickies the scene holds, as last queued. On the thread that renders.
 */
export class StickyAuthorLabels {
  #authors: StickyAuthors = NO_STICKY_AUTHORS;
  readonly #stickies = new Map<ObjectId, BoardObject>();
  /**
   * The object lookup of the change set queued last, before labels: an author change reads its
   * objects through it, so when the renderer's queue merges the sets of one frame and reads every
   * id through the latest set (`SceneChangeQueue.drain`) it reads them as it would have without
   * the author change.
   */
  #lastGet: ((id: ObjectId) => BoardObject | undefined) | undefined;

  /**
   * A change set with each sticky's label resolved onto it, noting the stickies it creates,
   * updates and deletes. A retained root move stays one (the scene knows it by identity), so a
   * moving sticky keeps its label.
   *
   * @param changes - The change set as the scene would read it.
   * @returns The same changes, stickies labelled.
   */
  resolve(changes: SceneChangeSet): SceneChangeSet {
    for (const id of changes.deleted) this.#stickies.delete(id);
    for (const id of [...changes.created, ...changes.updated]) {
      const object = changes.get(id);
      if (object?.type === 'sticky') this.#stickies.set(id, object);
      else this.#stickies.delete(id);
    }
    this.#lastGet = (id) => changes.get(id);
    const labelled: SceneChangeSet = { ...changes, get: (id) => this.#labelled(changes.get(id)) };
    return isRootMoveChanges(changes) ? markRootMoveChanges(labelled) : labelled;
  }

  /**
   * Replaces the board's authors.
   *
   * @param authors - The authors.
   * @returns How many stickies' labels changed, and the change set that redraws just them, if
   *   any did.
   */
  set(authors: StickyAuthors): {
    readonly count: number;
    readonly changes: SceneChangeSet | undefined;
  } {
    const before = this.#authors;
    this.#authors = authors;
    const updated: ObjectId[] = [];
    for (const [id, object] of this.#stickies) {
      if (stickyAuthorTextOf(object, before) !== stickyAuthorTextOf(object, authors)) {
        updated.push(id);
      }
    }
    if (updated.length === 0) return { count: 0, changes: undefined };
    const previous = this.#lastGet;
    const get = (id: ObjectId): BoardObject | undefined => previous?.(id) ?? this.#stickies.get(id);
    this.#lastGet = get;
    const changes: SceneChangeSet = {
      created: [],
      updated,
      deleted: [],
      get: (id) => this.#labelled(get(id)),
    };
    return { count: updated.length, changes };
  }

  /**
   * An object as the passes read it: a sticky with its label, when the board shows one.
   *
   * @param object - The object, or undefined.
   * @returns The object, labelled where it has a label.
   */
  #labelled(object: BoardObject | undefined): BoardObject | undefined {
    if (object?.type !== 'sticky') return object;
    const label = stickyAuthorTextOf(object, this.#authors);
    if (label === undefined) return object;
    const labelled: LabelledObject = { ...object, [STICKY_AUTHOR_LABEL]: label };
    return labelled;
  }
}
