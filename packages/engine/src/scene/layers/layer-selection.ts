import type { ObjectId } from '@canvas/schema';

import { isSameCamera, visibleWorldBounds, type Camera } from '../../camera/camera.js';
import { tableEntry } from '../segments/table-entry.js';

import {
  LAYER_LIMIT,
  LAYER_SMALL_BAND,
  LAYER_SCRATCH_BYTES_PER_TEXEL,
  LAYER_SMALL_EDGE_PX,
  layerScratchBytes,
  layerTargetBytes,
  layerTargetExtent,
  type LayerExtent,
} from './layer-budget.js';
import type { LayerCandidate, LayerChoice, LayerSelectionOptions } from './layer-choice.js';
import { byPriority, isWithinView, limitOrder } from './layer-limit.js';
import { canvasDeviceRect, layerDeviceRect } from './layer-rect.js';

export type { LayerCandidate, LayerChoice, LayerSelectionOptions } from './layer-choice.js';

/**
 * The hysteresis band of the layers budget: a layer that fell back for the budget
 * composites again only while a fifth of the targets' share (the budget less the scratch) stays
 * free after it, so one near the edge does not alternate frame to frame.
 */
export const LAYER_BUDGET_BAND = 0.2;

/** A layer's form: composited, or why it falls back. */
const COMPOSITED = 0;
const SMALL = 1;
const OVER_LIMIT = 2;
const OVER_BUDGET = 3;

/** A layer's small state: not measured yet, small, or large. */
const UNKNOWN = 0;
const IS_SMALL = 1;
const IS_LARGE = 2;

/** Device pixels a layer's rectangle may reach past its bounds (its margin and rounding). */
const REACH_PX = 2;

const NO_BYTES: ReadonlyMap<string, number> = new Map();

/** No layer's targets' extents. */
const NO_EXTENTS: ReadonlyMap<string, LayerExtent> = new Map();
const NO_IDS: readonly ObjectId[] = [];

/** A candidate on the canvas past the small test, with what ranks it. */
interface Ranked {
  readonly index: number;
  readonly id: ObjectId;
  readonly depth: number;
  readonly area: number;
  readonly bytes: number;
  /** The extent its targets take in the scratch. */
  readonly extent: LayerExtent;
}

/**
 * Adds an id to a set or deletes it.
 *
 * @param set - The set.
 * @param id - The id.
 * @param isMember - Whether it belongs.
 */
function setMember(set: Set<ObjectId>, id: ObjectId, isMember: boolean): void {
  if (isMember) set.add(id);
  else set.delete(id);
}

/**
 * Chooses, each frame, which layers composite and which fall back to the multiply form
 * (s): a layer under 64 device pixels on its longer edge falls back,
 * with a band (`LAYER_SMALL_BAND`) remembered per layer so a slow zoom never alternates its form;
 * of the rest that show on the canvas, at most 16 composite, the outermost first, then the
 * larger (by its content's area in device pixels, wherever the canvas cuts it), then the lower
 * id, with a band: one that composited when last on the canvas keeps its slot while it stays
 * within the budget, and a newcomer takes a free slot or one it is clearly ahead of
 * (`limitOrder`: outer, or a quarter larger); and one whose targets would reach the layers' budget (the scratch, charged once, plus
 * every chosen layer's bucketed tiles, or the larger targets it keeps) falls back too, and
 * composites again only with a fifth of the targets' share to spare (`LAYER_BUDGET_BAND`). A
 * layer off the canvas keeps its last form, uncounted, so a pan changes nothing for it. Each
 * fallen-back layer counts once, under the first reason that holds. A frame's choice depends
 * only on the candidates, the camera and what is remembered of earlier frames.
 *
 * Built for boards of tens of thousands of layers: the forms are kept per candidate in arrays
 * while the candidates keep their ids and order (`select`'s `layout`), a frame with the same
 * candidates, camera and held targets chooses nothing again, and a choice reports only the
 * layers whose form changed, the sets kept up to date in place. The frame's thread.
 */
export class LayerSelection {
  private readonly limit: number;
  private readonly byteBudget: number;
  private readonly tile: number;
  private readonly heldBytes: (() => ReadonlyMap<string, number>) | undefined;
  private readonly heldExtent: (() => ReadonlyMap<string, LayerExtent>) | undefined;
  private readonly scratchRate: number;
  private readonly fallbacks = new Set<ObjectId>();
  private readonly inline = new Set<ObjectId>();
  private readonly excluded = new Set<ObjectId>();
  /** The layers whose last budget test failed: they return only within the band. */
  private readonly overBudget = new Set<ObjectId>();
  /**
   * The layers that composited on or near the canvas last frame: they keep their slots (the
   * limit's band).
   */
  private readonly composited = new Set<ObjectId>();
  /** The layout the arrays follow, and per candidate its small state and form. */
  private layout: object | undefined;
  private ids: readonly ObjectId[] = [];
  private smallStates: Int32Array = new Int32Array(0);
  private forms: Int32Array = new Int32Array(0);
  /** Each layer's small state and form, kept across a change of layout. */
  private readonly smallById = new Map<ObjectId, number>();
  private readonly formById = new Map<ObjectId, number>();
  private memo:
    | {
        readonly candidates: readonly LayerCandidate[];
        readonly camera: Camera;
        readonly held: ReadonlyMap<string, number>;
        readonly choice: LayerChoice;
      }
    | undefined;

  /**
   * Creates the selection.
   *
   * @param options - The limit, budget, tile edge and held bytes.
   */
  constructor(options: LayerSelectionOptions) {
    this.limit = options.limit ?? LAYER_LIMIT;
    this.byteBudget = options.byteBudget;
    this.tile = options.tile;
    this.heldBytes = options.heldBytes;
    this.heldExtent = options.heldExtent;
    this.scratchRate = options.scratchBytesPerTexel ?? LAYER_SCRATCH_BYTES_PER_TEXEL;
  }

  /**
   * Chooses the frame's fallbacks.
   *
   * @param candidates - Every layer with content.
   * @param camera - The frame's camera.
   * @param layout - What stays the same while the candidates keep their ids and order
   *   (`LayerCandidates.ids`); default the candidates themselves.
   * @returns The choice, and what changed since the last.
   */
  select(
    candidates: readonly LayerCandidate[],
    camera: Camera,
    layout: object = candidates,
  ): LayerChoice {
    const held = this.heldBytes?.() ?? NO_BYTES;
    const { memo } = this;
    if (
      memo?.candidates === candidates &&
      memo.held === held &&
      isSameCamera(camera, memo.camera)
    ) {
      return memo.choice;
    }
    const gone = layout === this.layout ? [] : this.follow(candidates, layout);
    const forms = new Int32Array(candidates.length);
    const ranked: Ranked[] = [];
    let small = 0;
    const scale = camera.zoom * camera.dpr;
    const view = visibleWorldBounds(camera);
    const reach = REACH_PX / scale;
    const canvas = canvasDeviceRect(camera);
    const heldExtent = this.heldExtent?.() ?? NO_EXTENTS;
    candidates.forEach(({ id, depth, bounds }, index) => {
      const width = (bounds.maxX - bounds.minX) * scale;
      const height = (bounds.maxY - bounds.minY) * scale;
      if (this.isSmall(index, Math.max(width, height))) {
        forms[index] = SMALL;
        small += 1;
        return;
      }
      const isNear =
        bounds.maxX > view.minX - reach &&
        bounds.minX < view.maxX + reach &&
        bounds.maxY > view.minY - reach &&
        bounds.minY < view.maxY + reach;
      const rect = isNear ? layerDeviceRect(bounds, camera, canvas) : undefined;
      const keeps = heldExtent.get(id);
      if (rect === undefined) {
        if (this.composited.has(id) && isWithinView(bounds, view)) {
          // Just off the canvas, it keeps its slot and what it holds (the limit's band).
          const extent = keeps ?? { width: 0, height: 0 };
          ranked.push({ index, id, depth, area: width * height, bytes: held.get(id) ?? 0, extent });
        } else forms[index] = tableEntry(this.forms, index); // Off the canvas: its last form.
        return;
      }
      const bytes = Math.max(layerTargetBytes(rect, this.tile), held.get(id) ?? 0);
      const needs = layerTargetExtent(rect, this.tile);
      const extent = {
        width: Math.max(needs.width, keeps?.width ?? 0),
        height: Math.max(needs.height, keeps?.height ?? 0),
      };
      ranked.push({ index, id, depth, area: width * height, bytes, extent });
    });
    ranked.sort(byPriority);
    const order = limitOrder(ranked, (layer) => this.composited.has(layer), this.limit);
    const counts = this.bound(order, forms);
    // A layer holds its slot only while it stays on the canvas or near it, composited.
    this.composited.clear();
    for (const { id, index } of ranked) if (forms[index] === COMPOSITED) this.composited.add(id);
    const choice: LayerChoice = { ...this.apply(forms, gone), small, ...counts };
    const quiet = { ...choice, added: NO_IDS, removed: NO_IDS, isExcludedChanged: false };
    this.memo = { candidates, camera: { ...camera }, held, choice: quiet };
    return choice;
  }

  /**
   * Forgets the budget band of layers no longer in layer form or no longer on the board, and
   * chooses again at the next frame.
   *
   * @param isLayer - Whether an id is still a layer.
   */
  retain(isLayer: (id: ObjectId) => boolean): void {
    for (const set of [this.overBudget, this.composited]) {
      for (const id of set) if (!isLayer(id)) set.delete(id);
    }
    this.memo = undefined;
  }

  /**
   * Forgets every layer: the board has none left. The next choice starts afresh.
   *
   * @returns The layers that were drawn in the multiply form, which composite no more.
   */
  reset(): ObjectId[] {
    const removed = [...this.fallbacks];
    for (const set of [
      this.fallbacks,
      this.inline,
      this.excluded,
      this.overBudget,
      this.composited,
    ]) {
      set.clear();
    }
    this.smallById.clear();
    this.formById.clear();
    this.layout = undefined;
    this.ids = [];
    this.smallStates = new Int32Array(0);
    this.forms = new Int32Array(0);
    this.memo = undefined;
    return removed;
  }

  /**
   * Moves the per-candidate arrays to a new layout, by id: a layer keeps its small state and
   * form, a new one starts unknown and composited, and a layer gone leaves the sets.
   *
   * @param candidates - The new candidates.
   * @param layout - Their layout.
   * @returns The layers that left the fallbacks for being gone.
   */
  private follow(candidates: readonly LayerCandidate[], layout: object): ObjectId[] {
    this.ids.forEach((id, index) => {
      this.smallById.set(id, tableEntry(this.smallStates, index));
      this.formById.set(id, tableEntry(this.forms, index));
    });
    const ids = candidates.map(({ id }) => id);
    const present = new Set(ids);
    for (const id of this.smallById.keys()) if (!present.has(id)) this.smallById.delete(id);
    for (const id of this.formById.keys()) if (!present.has(id)) this.formById.delete(id);
    this.smallStates = Int32Array.from(ids, (id) => this.smallById.get(id) ?? UNKNOWN);
    this.forms = Int32Array.from(ids, (id) => this.formById.get(id) ?? COMPOSITED);
    for (const id of this.composited) if (!present.has(id)) this.composited.delete(id);
    const gone: ObjectId[] = [];
    for (const id of this.fallbacks) {
      if (present.has(id)) continue;
      gone.push(id);
      for (const set of [this.fallbacks, this.inline, this.excluded]) set.delete(id);
    }
    this.ids = ids;
    this.layout = layout;
    return gone;
  }

  /**
   * Takes the frame's forms: the sets change in place for the layers whose form changed.
   *
   * @param forms - Each candidate's form this frame.
   * @param gone - The layers that left the fallbacks for being gone.
   * @returns The live sets and the changes.
   */
  private apply(
    forms: Int32Array,
    gone: ObjectId[],
  ): Omit<LayerChoice, 'small' | 'limit' | 'budget'> {
    const added: ObjectId[] = [];
    const removed = gone;
    let isExcludedChanged = gone.length > 0;
    this.ids.forEach((id, index) => {
      const form = tableEntry(forms, index);
      const was = tableEntry(this.forms, index);
      if (form === was) return;
      if (was === COMPOSITED) added.push(id);
      if (form === COMPOSITED) removed.push(id);
      const isExcluded = form === SMALL || form === OVER_LIMIT;
      if (isExcluded !== (was === SMALL || was === OVER_LIMIT)) isExcludedChanged = true;
      setMember(this.fallbacks, id, form !== COMPOSITED);
      setMember(this.inline, id, form === OVER_BUDGET);
      setMember(this.excluded, id, isExcluded);
    });
    this.forms = forms;
    const { fallbacks, inline, excluded } = this;
    return { fallbacks, inline, excluded, added, removed, isExcludedChanged };
  }

  /**
   * Applies the limit and the budget to the ranked candidates, in order: past the limit a layer
   * falls back; within it, one whose bytes would reach the budget (or, after it fell back for
   * the budget, the band's lower mark) falls back and is drawn in place.
   *
   * @param ranked - The candidates on the canvas, in the limit's order (`limitOrder`).
   * @param forms - Each candidate's form, written.
   * @returns How many fell back past the limit and for the budget.
   */
  private bound(ranked: readonly Ranked[], forms: Int32Array): { limit: number; budget: number } {
    let limit = 0;
    let budget = 0;
    let chosen = 0;
    let bytes = 0;
    // The scratch takes the chosen targets' widest width by their tallest height.
    let extent: LayerExtent = { width: 0, height: 0 };
    for (const layer of ranked) {
      const grown = {
        width: Math.max(extent.width, layer.extent.width),
        height: Math.max(extent.height, layer.extent.height),
      };
      const scratch = this.scratchOf(grown);
      // The band is a fifth of the targets' share: the budget less the scratch.
      const band = LAYER_BUDGET_BAND * Math.max(0, this.byteBudget - scratch);
      const mark = this.overBudget.has(layer.id) ? this.byteBudget - band : this.byteBudget;
      if (chosen >= this.limit) {
        forms[layer.index] = OVER_LIMIT;
        limit += 1;
      } else if (bytes + layer.bytes + scratch >= mark) {
        forms[layer.index] = OVER_BUDGET;
        this.overBudget.add(layer.id);
        budget += 1;
      } else {
        forms[layer.index] = COMPOSITED;
        this.overBudget.delete(layer.id);
        bytes += layer.bytes;
        extent = grown;
        chosen += 1;
      }
    }
    return { limit, budget };
  }

  /**
   * The scratch's bytes at an extent, at the backend's rate.
   *
   * @param extent - The extent.
   * @returns The bytes.
   */
  private scratchOf(extent: LayerExtent): number {
    return layerScratchBytes(extent, this.scratchRate);
  }

  /**
   * Whether a candidate is small this frame, through its band: one seen for the first time is
   * small under the threshold; a small one stays so until it reaches the band's top, a
   * composited one until it falls under the band's bottom.
   *
   * @param index - The candidate's index in the layout.
   * @param edge - Its content's longer edge, device pixels.
   * @returns True when small; remembered for the next frame.
   */
  private isSmall(index: number, edge: number): boolean {
    const was = tableEntry(this.smallStates, index);
    const threshold =
      was === UNKNOWN
        ? LAYER_SMALL_EDGE_PX
        : was === IS_SMALL
          ? LAYER_SMALL_EDGE_PX / (1 - LAYER_SMALL_BAND)
          : LAYER_SMALL_EDGE_PX * (1 - LAYER_SMALL_BAND);
    const isSmall = edge < threshold;
    this.smallStates[index] = isSmall ? IS_SMALL : IS_LARGE;
    return isSmall;
  }
}
