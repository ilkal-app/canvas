import { DrawableGate } from '../drawable/drawable-gate.js';
import type { StickyAuthors } from '../text/scene/sticky-author-box.js';

import { withResolvedFrameNames } from './frame-name-changes.js';
import type { SceneChangeQueue } from './scene-change-queue.js';
import type { SceneHierarchy } from './scene-hierarchy.js';
import type { SceneChangeSet } from './scene-source.js';
import { StickyAuthorLabels } from './sticky-author-labels.js';

/**
 * How a renderer's scene reads the change sets it queues: undrawable objects absent (the
 * drawable gate), each frame's name display resolved over its ancestors
 * (`withResolvedFrameNames`) and each sticky's author label resolved
 * (`StickyAuthorLabels`). On the thread that renders.
 */
export class SceneReading {
  /** Judges every change set before the scene reads it: undrawable objects are absent. */
  readonly gate = new DrawableGate();
  readonly #labels = new StickyAuthorLabels();
  readonly #hierarchy: () => SceneHierarchy;

  /**
   * Reads for a scene.
   *
   * @param hierarchy - The scene's hierarchy, read at each change set.
   */
  constructor(hierarchy: () => SceneHierarchy) {
    this.#hierarchy = hierarchy;
  }

  /**
   * A change set as the scene reads it.
   *
   * @param changes - The change set, as the document produced it.
   * @returns The change set to queue.
   */
  read(changes: SceneChangeSet): SceneChangeSet {
    return this.#labels.resolve(
      withResolvedFrameNames(this.gate.filter(changes), this.#hierarchy()),
    );
  }

  /**
   * A change set with the sticky author labels only (a retained move's, which the renderer does
   * not gate again or resolve frame names for); a root move stays one.
   *
   * @param changes - The change set, gated.
   * @returns The change set to queue.
   */
  label(changes: SceneChangeSet): SceneChangeSet {
    return this.#labels.resolve(changes);
  }

  /**
   * Replaces the board's sticky authors, queuing just the stickies whose label changed.
   *
   * @param authors - The authors.
   * @param queue - The renderer's change queue.
   * @returns How many stickies' labels changed.
   */
  setStickyAuthors(authors: StickyAuthors, queue: SceneChangeQueue): number {
    const { count, changes } = this.#labels.set(authors);
    if (changes !== undefined) queue.push(changes);
    return count;
  }
}
