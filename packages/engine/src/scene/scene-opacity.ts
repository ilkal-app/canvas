import type { BoardObject, ObjectId } from '@canvas/schema';

import { isLayerForm, ownOpacityOf } from './layers/layer-form.js';
import type { SceneHierarchy } from './scene-hierarchy.js';
import type { SceneSource } from './scene-source.js';

/** How many ancestors the walk follows at most: past it, a corrupt parent chain stops it. */
const MAX_ANCESTOR_DEPTH = 256;

/** How a {@link SceneOpacity} treats objects in layer form. */
export interface SceneOpacityOptions {
  /**
   * Whether objects in layer form (`isLayerForm`) draw into a layer composited at their opacity
   * (the renderer has the layer-composite pass). Then a record's multiplier stops at
   * its nearest layer-form ancestor, and a layer-form object's own opacity is the composite's,
   * not its records'. Default false: every opacity multiplies (C1's multiply form).
   */
  readonly isLayerFormDrawn?: boolean;
}

/** What the multipliers need of a translucent object once the document is out of reach. */
interface Translucent {
  /** Its own opacity, below 1. */
  readonly own: number;
  /** Whether it is in layer form (`isLayerForm`). */
  readonly isLayerForm: boolean;
}

/**
 * The scene's layer opacity bookkeeping: each mirrored object's multiplier, its own
 * opacity times every ancestor's (groups, frames, mains and instances; a virtual instance
 * child's chain runs through its instance, which shows its main's opacity when it sets none, as
 * `withMainOpacity` hands it down). When layer form is drawn
 * (`SceneOpacityOptions.isLayerFormDrawn`), the product is relative to the nearest layer: it
 * stops at the nearest layer-form ancestor, whose composite applies its opacity once, and leaves
 * out a layer-form object's own opacity, so nothing multiplies across a layer's boundary. A
 * record carries it as a trailing
 * transparency (`InstanceLayout.opacityFloat`, 1 minus the multiplier), which every scene shader
 * multiplies into its coverage, an image's as any other's (so its border, another pass's
 * record, fades with it; a translucent bordered image is a layer). Ancestors are
 * worked out at most once per `Scene.apply` (`beginApply`), and a changed ancestor's descendants
 * are rewritten by the scene anyway, so they follow. Only multipliers below 1 are kept, so an
 * opaque board holds nothing. A layer the frame draws in the multiply form instead (
 * too small, past the limit or over budget, {@link SceneOpacity.changeFallbacks}) is not a layer
 * here: its opacity multiplies into its own records and its descendants'. CPU-only, owned by the
 * `Scene`.
 */
export class SceneOpacity {
  /** The cumulative opacity of each object whose records carry one below 1. */
  private readonly recordById = new Map<ObjectId, number>();
  /** Per ancestor, the multiplier its children inherit, worked out this apply. */
  private readonly memo = new Map<ObjectId, number>();
  private readonly isLayerFormDrawn: boolean;
  /** Layers in layer form drawn in the multiply form this frame. */
  private readonly fallbacks = new Set<ObjectId>();
  /** Each translucent object's own opacity and form, kept only when layer form is drawn. */
  private readonly translucent = new Map<ObjectId, Translucent>();

  /**
   * Creates the bookkeeping.
   *
   * @param options - Whether layer form is drawn.
   */
  constructor(options: SceneOpacityOptions = {}) {
    this.isLayerFormDrawn = options.isLayerFormDrawn ?? false;
  }

  /** Starts a new document state: ancestors are worked out afresh, once each. */
  beginApply(): void {
    if (this.memo.size > 0) this.memo.clear();
  }

  /**
   * The multiplier an object's records carry, as last worked out by {@link SceneOpacity.update}:
   * its cumulative opacity (an image's own included), relative to its nearest layer.
   *
   * @param id - The object.
   * @returns The multiplier, from 0 to 1.
   */
  recordMultiplierOf(id: ObjectId): number {
    return this.recordById.get(id) ?? 1;
  }

  /**
   * Brings an object's opacity up to date with the document. Called for every object the scene
   * upserts.
   *
   * @param object - The object as the document holds it now; not mutated.
   * @param source - The document, for its ancestors.
   * @returns The multiplier its records carry, from 0 to 1.
   */
  update(object: BoardObject, source: SceneSource): number {
    const ancestors = object.parentId === null ? 1 : this.cumulativeOf(object.parentId, source);
    const ownOpacity = ownOpacityOf(object);
    if (this.isLayerFormDrawn) this.noteTranslucent(object, ownOpacity);
    const own = this.isLayer(object) ? 1 : ownOpacity;
    const record = ancestors * own;
    if (record < 1) this.recordById.set(object.id, record);
    else this.recordById.delete(object.id);
    return ancestors * own;
  }

  /**
   * Whether an object composites its own opacity as a layer.
   *
   * @param object - The object.
   * @returns True when layer form is drawn and the object is in it.
   */
  private isLayer(object: BoardObject): boolean {
    return this.isLayerFormDrawn && !this.fallbacks.has(object.id) && isLayerForm(object);
  }

  /**
   * Remembers a translucent object's own opacity and form, and forgets an opaque one's.
   *
   * @param object - The object.
   * @param own - Its own opacity.
   */
  private noteTranslucent(object: BoardObject, own: number): void {
    if (own < 1) {
      this.translucent.set(object.id, {
        own,
        isLayerForm: isLayerForm(object),
      });
    } else if (this.translucent.size > 0) this.translucent.delete(object.id);
  }

  /**
   * Changes which layers are drawn in the multiply form, and names the layers whose
   * form that changes: their records and their descendants' then need
   * {@link SceneOpacity.refresh}. Ids that are not objects in layer form change nothing.
   *
   * @param added - Layers now drawn in the multiply form.
   * @param removed - Layers that composite again.
   * @returns The objects whose form changed.
   */
  changeFallbacks(added: Iterable<ObjectId>, removed: Iterable<ObjectId>): ObjectId[] {
    const changed: ObjectId[] = [];
    const isFlipped = (id: ObjectId): boolean => this.translucent.get(id)?.isLayerForm === true;
    for (const id of added) {
      if (this.fallbacks.has(id)) continue;
      this.fallbacks.add(id);
      if (isFlipped(id)) changed.push(id);
    }
    for (const id of removed) if (this.fallbacks.delete(id) && isFlipped(id)) changed.push(id);
    return changed;
  }

  /**
   * Works an object's record multiplier out again from what was last applied (the hierarchy and
   * the translucent objects' opacities), without the document: after
   * {@link SceneOpacity.changeFallbacks} changed a layer's form above it.
   *
   * @param id - The object.
   * @param hierarchy - The scene's parent tree.
   * @returns The multiplier its records carry, from 0 to 1.
   */
  refresh(id: ObjectId, hierarchy: SceneHierarchy): number {
    let ancestors = 1;
    let current = hierarchy.parentOf(id);
    for (let depth = 0; current !== null && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
      const ancestor = this.translucent.get(current);
      if (ancestor !== undefined) {
        if (this.isTranslucentLayer(current, ancestor)) break;
        ancestors *= ancestor.own;
      }
      current = hierarchy.parentOf(current);
    }
    const self = this.translucent.get(id);
    const own = self === undefined || this.isTranslucentLayer(id, self) ? 1 : self.own;
    const record = ancestors * own;
    if (record < 1) this.recordById.set(id, record);
    else this.recordById.delete(id);
    return record;
  }

  /**
   * Whether a translucent object composites its own opacity as a layer.
   *
   * @param id - The object.
   * @param translucent - What is kept of it.
   * @returns True when in layer form and not drawn in the multiply form.
   */
  private isTranslucentLayer(id: ObjectId, translucent: Translucent): boolean {
    return translucent.isLayerForm && !this.fallbacks.has(id);
  }

  /**
   * Forgets a removed object.
   *
   * @param id - The object.
   */
  remove(id: ObjectId): void {
    this.recordById.delete(id);
    this.translucent.delete(id);
  }

  /**
   * The multiplier an ancestor hands its children, its chain worked out once this apply: its own
   * opacity times its parent's, or 1 for a layer-form ancestor when layers are drawn. A missing
   * ancestor (not loaded, another page) and a cycle end the chain as opaque.
   *
   * @param id - The ancestor.
   * @param source - The document.
   * @returns The multiplier.
   */
  private cumulativeOf(id: ObjectId, source: SceneSource): number {
    const pending: BoardObject[] = [];
    let base = 1;
    let current: ObjectId | null = id;
    while (current !== null && pending.length < MAX_ANCESTOR_DEPTH) {
      const known = this.memo.get(current);
      if (known !== undefined) {
        base = known;
        break;
      }
      const object = source.get(current);
      if (object === undefined || pending.some(({ id: seen }) => seen === current)) break;
      pending.push(object);
      current = object.parentId;
    }
    // Outermost first, so each memo entry is its own chain's product.
    for (const object of pending.reverse()) {
      base = this.isLayer(object) ? 1 : base * ownOpacityOf(object);
      this.memo.set(object.id, base);
    }
    return base;
  }
}
