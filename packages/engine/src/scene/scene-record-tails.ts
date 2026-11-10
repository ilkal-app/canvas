import type { BoardObject, ObjectId } from '@canvas/schema';

import { SceneClips } from './scene-clips.js';
import { SceneOpacity } from './scene-opacity.js';
import type { RecordTails } from './scene-records.js';
import type { SceneSource } from './scene-source.js';

/**
 * What the scene writes after a pass prepares each record: the object's clip
 * index (`SceneClips`) and its layer opacity (`SceneOpacity`), kept in step with the document
 * together, so the scene upserts, applies and removes them as one. CPU-only, owned by the
 * `Scene`.
 */
export class SceneRecordTails implements RecordTails {
  /** The clip indices and the clip table they name. */
  readonly clips = new SceneClips();
  /** The layer opacity multipliers, relative to the nearest layer when layers are drawn. */
  readonly opacity: SceneOpacity;

  /**
   * Creates the tails.
   *
   * @param isLayerFormDrawn - Whether objects in layer form composite their own opacity through
   *   planned layers (`SceneOptions.isLayerFormDrawn`). Default false.
   */
  constructor(isLayerFormDrawn = false) {
    this.opacity = new SceneOpacity({ isLayerFormDrawn });
  }

  /** Starts a new document state: clip chains and ancestors' opacities are worked out afresh. */
  beginApply(): void {
    this.clips.beginApply();
    this.opacity.beginApply();
  }

  /**
   * Brings an object's clip index and opacity up to date with the document. Called for every
   * object the scene upserts.
   *
   * @param object - The object as the document holds it now; not mutated.
   * @param source - The document, for its ancestors.
   */
  update(object: BoardObject, source: SceneSource): void {
    this.clips.update(object, source);
    this.opacity.update(object, source);
  }

  /** @inheritdoc */
  clipIndexOf(id: ObjectId): number {
    return this.clips.indexOf(id);
  }

  /** @inheritdoc */
  opacityOf(id: ObjectId): number {
    return this.opacity.recordMultiplierOf(id);
  }

  /**
   * Forgets a removed object.
   *
   * @param id - The object.
   */
  remove(id: ObjectId): void {
    this.clips.remove(id);
    this.opacity.remove(id);
  }
}
