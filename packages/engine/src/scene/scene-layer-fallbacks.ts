import type { ObjectId } from '@canvas/schema';

import type { PassState } from './pass-state.js';
import type { SceneHierarchy } from './scene-hierarchy.js';
import type { SceneOpacity } from './scene-opacity.js';

/** The float of a transparency write, reused so a write allocates nothing. */
const TRANSPARENCY = new Float32Array(1);

/**
 * The scene's layer fallbacks (`Scene.layerOpacity`): which layers in layer form
 * draw in the multiply form this frame, and the opacity each object's records carry because of
 * them. The scene's thread.
 */
export interface SceneLayerOpacity {
  /**
   * Changes which layers are drawn in the multiply form, rewriting the transparency of each
   * changed layer's records and its descendants'.
   *
   * @param added - Layers now drawn in the multiply form.
   * @param removed - Layers that composite again.
   * @returns How many records changed.
   */
  changeFallbacks(added: Iterable<ObjectId>, removed: Iterable<ObjectId>): number;
  /**
   * What an object's records multiply by: for a layer that composites, the opacity of its
   * ancestors drawn in the multiply form up to the nearest layer that composites.
   *
   * @param id - The object.
   * @returns The multiplier, from 0 to 1.
   */
  multiplierOf(id: ObjectId): number;
}

/** {@link SceneLayerOpacity} over the scene's bookkeeping. The scene's thread. */
export class SceneLayerFallbacks implements SceneLayerOpacity {
  /**
   * Wraps the scene's bookkeeping.
   *
   * @param opacity - The scene's opacity multipliers.
   * @param hierarchy - The scene's parent tree.
   * @param states - Every pass.
   */
  constructor(
    private readonly opacity: SceneOpacity,
    private readonly hierarchy: SceneHierarchy,
    private readonly states: readonly PassState[],
  ) {}

  /**
   * Changes which layers are drawn in the multiply form and rewrites the transparency of every
   * record whose multiplier that changes: each layer whose form changed, then its descendants,
   * once each. Only the trailing float is written (`InstanceLayout.opacityFloat`), and only where
   * its value changes; nothing is prepared again and no slot moves.
   *
   * @param added - Layers now drawn in the multiply form.
   * @param removed - Layers that composite again.
   * @returns How many records changed.
   */
  changeFallbacks(added: Iterable<ObjectId>, removed: Iterable<ObjectId>): number {
    const { opacity, hierarchy } = this;
    let changed = 0;
    const visited = new Set<ObjectId>();
    const pending = opacity.changeFallbacks(added, removed);
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      if (visited.has(id)) continue;
      visited.add(id);
      TRANSPARENCY[0] = 1 - opacity.refresh(id, hierarchy);
      for (const { pass, buffer, slotsById } of this.states) {
        const { opacityFloat } = pass.layout;
        const slots = slotsById.get(id);
        if (opacityFloat === undefined || slots === undefined) continue;
        changed += buffer.writePartialMany(slots, slots.length, opacityFloat, TRANSPARENCY);
      }
      pending.push(...hierarchy.childrenOf(id));
    }
    return changed;
  }

  /**
   * What an object's records multiply by (`SceneOpacity.recordMultiplierOf`): for a layer that
   * composites, the opacity of the ancestors between it and the nearest layer that composites,
   * all of them drawn in the multiply form, which its composite applies with its own.
   *
   * @param id - The object.
   * @returns The multiplier, from 0 to 1.
   */
  multiplierOf(id: ObjectId): number {
    return this.opacity.recordMultiplierOf(id);
  }
}
