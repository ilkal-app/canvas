// Variable faces' instances by key, held weakly: one object per key while any caller
// holds it, however often its font is dropped and made again.

import { MAX_VARIATION_INSTANCES } from './instance-fonts.js';

/** The size at which the keys are first swept of faces no caller holds. */
const FIRST_SWEEP = 2 * MAX_VARIATION_INSTANCES;

/**
 * Faces by key, held weakly; keys whose face was collected are swept when the map reaches a size
 * that then doubles what is left, so each key is swept a bounded number of times.
 *
 * @template Face - The face.
 */
export class HeldFaces<Face extends object> {
  private readonly refs = new Map<string, WeakRef<Face>>();
  private sweepAt = FIRST_SWEEP;

  /**
   * The face held for a key.
   *
   * @param key - The key.
   * @returns The face, or undefined when none is held.
   */
  get(key: string): Face | undefined {
    return this.refs.get(key)?.deref();
  }

  /**
   * Holds a face for a key, weakly.
   *
   * @param key - The key.
   * @param face - The face.
   */
  set(key: string, face: Face): void {
    const { refs } = this;
    if (refs.size >= this.sweepAt) {
      const held = [...refs].filter(([, ref]) => ref.deref() !== undefined);
      refs.clear();
      for (const [heldKey, ref] of held) refs.set(heldKey, ref);
      this.sweepAt = Math.max(FIRST_SWEEP, 2 * refs.size);
    }
    refs.set(key, new WeakRef(face));
  }
}
