import type { ObjectId } from '@canvas/schema';

import type { FrameContext } from '../frame-context.js';
import { LAYER_COMPOSITE_PASS_NAME } from '../layers/layer-composite-pass-name.js';
import { LayerCompositor } from '../layers/layer-compositor.js';
import type { LayerDraw } from '../layers/layer-draw.js';
import type { LayerSelection } from '../layers/layer-selection.js';
import type { ScenePassResources } from '../scene-pass-resources.js';

import type { LayeredPlan } from './layer-planning.js';
import type { LayeredRanks, LayeredSegments } from './layered-segments.js';
import type { ZOrderMirror } from './z-order-mirror.js';

const NONE: ReadonlySet<ObjectId> = new Set();

/** The layers a frame plans, after its fallbacks. */
export interface DrawnLayers {
  /** Whether the planned fallbacks changed this frame, so the plan must be made again. */
  readonly isChanged: boolean;
  /** The layers the plan leaves out: small or past the limit this frame. */
  readonly excluded: ReadonlySet<ObjectId>;
  /** The planned layers that fell back for the budget: drawn in place (`LayerDraw.isInline`). */
  readonly inline: ReadonlySet<ObjectId>;
  /** Counts the changes of `excluded` (a live set), so a plan can tell it changed. */
  readonly excludedRevision: number;
}

/** No layers, no fallbacks. */
const NO_LAYERS: DrawnLayers = {
  isChanged: false,
  excluded: NONE,
  inline: NONE,
  excludedRevision: 0,
};

/**
 * The z-order segments' layer fallbacks: each frame with layers, the layer
 * composite pass's selection (`LayerSelection`: small, past the limit, over budget) chooses
 * which layers fall back to the multiply form, from layers measured only when the board changed
 * (`LayeredSegments.candidates`). The layers whose form changed have the transparency of their
 * subtrees rewritten (`Scene.layerOpacity`), and those records upload again. Small and
 * over-limit fallbacks leave the plan: the frame plans in full without them, so their content
 * joins their parent's window or the canvas and batches with it (their form changes rarely: the
 * small band, and the limit only as what is on the canvas changes). Budget fallbacks, which
 * follow every zoom near the budget's edge, stay planned and are drawn in place of their
 * composites (`LayerDraw.isInline`), so they never cost a re-plan; there are at most as many as
 * the limit. Counts each fallback reason in the frame's statistics. A board without layers
 * costs one size check. The frame's thread.
 */
export class SegmentLayerFallbacks {
  private selection: LayerSelection | null | undefined;
  /** Counts the changes of the selection's excluded layers. */
  private excludedRevision = 0;

  /**
   * Creates the fallbacks.
   *
   * @param layers - The z-order segments' layer planning, which measures the candidates.
   * @param mirror - The z-order segments' mirror: what changed since the last frame.
   * @param ranks - The paint order and rank tables, built on demand.
   */
  constructor(
    private readonly layers: LayeredSegments,
    private readonly mirror: ZOrderMirror,
    private readonly ranks: () => LayeredRanks,
  ) {}

  /**
   * Chooses the frame's layers. Call before the mirror's changes are cleared: the layers are
   * measured again when the paint order, slots, opacity 0 or (`isBoundsDirty`) a drawing bound
   * changed, and those holding or held by a changed object when only objects changed.
   *
   * @param context - The frame.
   * @param layerSlots - Every object in layer form with its composite slot.
   * @param isBoundsDirty - Whether a drawing bound (text) or a page table changed since the last
   *   plan.
   * @returns The layers to plan, and whether the choice changed.
   */
  choose(
    context: FrameContext,
    layerSlots: ReadonlyMap<ObjectId, readonly number[]>,
    isBoundsDirty: boolean,
  ): DrawnLayers {
    const { mirror } = this;
    const isStale =
      isBoundsDirty || mirror.isOrderDirty || mirror.isSlotsDirty || mirror.isVisibilityDirty;
    const isStructural = isStale || mirror.isOccludersDirty || layerSlots.size === 0;
    this.layers.observe(isStructural, mirror.updatedIds);
    const selection = this.selectionOf(context.passes);
    if (selection === undefined) return NO_LAYERS;
    if (layerSlots.size === 0) {
      this.layers.forget();
      this.change(context, [], selection.reset());
      return NO_LAYERS;
    }
    const measured = this.layers.candidates(isStale, mirror.updatedIds, layerSlots, this.ranks());
    if (isStale) selection.retain((id) => layerSlots.has(id));
    const choice = selection.select(measured.candidates, context.camera, measured.ids);
    context.stats.layersFallbackSmall = choice.small;
    context.stats.layersFallbackLimit = choice.limit;
    context.stats.layersFallbackBudget = choice.budget;
    this.change(context, choice.added, choice.removed);
    if (choice.isExcludedChanged) this.excludedRevision += 1;
    return {
      isChanged: choice.isExcludedChanged,
      excluded: choice.excluded,
      inline: choice.inline,
      excludedRevision: this.excludedRevision,
    };
  }

  /**
   * Takes the layers whose form changed: the scene rewrites their subtrees, and the rewritten
   * records upload again.
   *
   * @param context - The frame.
   * @param added - Layers now drawn in the multiply form.
   * @param removed - Layers that composite again.
   */
  private change(
    context: FrameContext,
    added: readonly ObjectId[],
    removed: readonly ObjectId[],
  ): void {
    if (added.length === 0 && removed.length === 0) return;
    // The dirty ranges were uploaded before the cull: these records go up now, before any pass.
    if (context.scene.layerOpacity.changeFallbacks(added, removed) > 0) {
      for (const pass of context.passes) pass.upload(context.stats);
    }
  }

  /**
   * The layer composite pass's selection, found once.
   *
   * @param passes - The renderer's passes.
   * @returns The selection, or undefined without the pass.
   */
  private selectionOf(passes: readonly ScenePassResources[]): LayerSelection | undefined {
    if (this.selection === undefined) {
      const drawer = passes.find(({ pass }) => pass.name === LAYER_COMPOSITE_PASS_NAME)?.drawer;
      this.selection = drawer instanceof LayerCompositor ? drawer.selection : null;
    }
    return this.selection ?? undefined;
  }
}

/**
 * A plan's layers for the frame, those that fell back for the budget marked to be drawn in
 * place (`LayerDraw.isInline`).
 *
 * @param plan - The layered plan, or none.
 * @param inline - The budget fallbacks.
 * @returns The frame's layers.
 */
export function inlined(
  plan: LayeredPlan | undefined,
  inline: ReadonlySet<ObjectId>,
): readonly LayerDraw[] {
  const layers = plan?.layers ?? [];
  if (inline.size === 0) return layers;
  return layers.map((layer) => (inline.has(layer.id) ? { ...layer, isInline: true } : layer));
}
