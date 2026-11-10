import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../../camera/camera.js';
import type { DrawListEntry } from '../draw-list.js';

import { tableEntry } from './table-entry.js';

/** What {@link structureOf} reads of a layered plan's input. */
export interface StructureInput {
  /** Per paint rank, its object (an object with a closing rank appears twice). */
  readonly paintOrder: readonly ObjectId[];
  /** Every object's own rank. */
  readonly rankById: ReadonlyMap<ObjectId, number>;
  /** The closing rank of each object that has one; every layer has one (its composite's). */
  readonly closingRankById: ReadonlyMap<ObjectId, number>;
  /** The objects in layer form with their composite slot. */
  readonly layerSlots: ReadonlyMap<ObjectId, readonly number[]>;
  /** Objects whose own opacity is 0. */
  readonly invisibleIds: ReadonlySet<ObjectId>;
  /** A member's box for its layer's bounds; omitted, every layer covers the whole plane. */
  readonly memberBoundsOf?: (id: ObjectId) => WorldBounds | undefined;
  /** Each layer's bounds already measured this frame. */
  readonly layerBounds?: ReadonlyMap<ObjectId, WorldBounds>;
  /** Layers in layer form planned as if they were not. */
  readonly excludedLayers?: ReadonlySet<ObjectId>;
  /**
   * Counts the changes of {@link StructureInput.excludedLayers} when it is a live set; omitted,
   * the set's contents are compared.
   */
  readonly excludedRevision?: number;
}

/** One layer while planning. */
export interface PlanningLayer {
  readonly id: ObjectId;
  readonly slot: number;
  readonly open: number;
  readonly close: number;
  /** Its index among the layers, innermost first. */
  readonly index: number;
  /** Its parent's index, or −1 for the canvas. */
  readonly parent: number;
  /** Whether its window draws anything, this plan. */
  isVisible: boolean;
  /** Its bounds, this plan. */
  bounds: WorldBounds | undefined;
}

/** A layered plan's windows: its layers and which holds each rank. */
export interface LayerStructure {
  /** The layers, innermost first (closing rank ascending). */
  readonly layers: readonly PlanningLayer[];
  /** Per rank, the innermost planned layer holding it (−1 for none). */
  readonly ownerOfRank: Int32Array;
  /** Per rank, 1 when an object at opacity 0 holds or encloses it. */
  readonly invisible: Uint8Array;
  /** What it was made from, to tell when it still stands. */
  readonly from: StructureKey;
  /** Every layer in layer form, planned or not, by closing rank; kept while the tables stand. */
  readonly all: readonly LayerSpanOf[];
  /** Indices into {@link LayerStructure.all} by own rank, ascending. */
  readonly allByOpen: Int32Array;
}

/** A layer in layer form: its id, composite slot and ranks. */
interface LayerSpanOf {
  readonly id: ObjectId;
  readonly slot: number;
  readonly open: number;
  readonly close: number;
}

/**
 * Every layer in layer form with its ranks, by closing rank, and its order by own rank.
 *
 * @param input - The tables.
 * @returns The layers and their order by own rank.
 */
function allLayersOf(input: StructureInput): { all: LayerSpanOf[]; allByOpen: Int32Array } {
  const all: LayerSpanOf[] = [];
  for (const [id, slots] of input.layerSlots) {
    const open = input.rankById.get(id);
    const close = input.closingRankById.get(id);
    const slot = slots[0];
    if (open === undefined || close === undefined || slot === undefined) continue;
    all.push({ id, slot, open, close });
  }
  all.sort((a, b) => a.close - b.close);
  const allByOpen = Int32Array.from(all.keys()).sort(
    (a, b) => (all[a]?.open ?? 0) - (all[b]?.open ?? 0),
  );
  return { all, allByOpen };
}

/** What a structure was made from. */
export interface StructureKey {
  readonly paintOrder: readonly ObjectId[];
  readonly rankById: ReadonlyMap<ObjectId, number>;
  readonly closingRankById: ReadonlyMap<ObjectId, number>;
  readonly layerSlots: ReadonlyMap<ObjectId, readonly number[]>;
  readonly layerCount: number;
  readonly invisibleIds: ReadonlySet<ObjectId>;
  readonly invisibleCount: number;
  readonly excluded: ReadonlySet<ObjectId>;
  readonly excludedRevision: number | undefined;
}

/** A layer's bounds without boxes to measure: the whole canvas (or its parent's rectangle). */
export const EVERYWHERE: WorldBounds = {
  minX: Number.NEGATIVE_INFINITY,
  minY: Number.NEGATIVE_INFINITY,
  maxX: Number.POSITIVE_INFINITY,
  maxY: Number.POSITIVE_INFINITY,
};

/**
 * The union of a layer's members' boxes, ranks from its own to its closing one: what its target
 * must hold. Pure apart from the reads.
 *
 * @param input - The plan's input.
 * @param layer - The layer's own and closing ranks.
 * @param layer.open - Its own rank.
 * @param layer.close - Its closing rank.
 * @returns The union, or undefined when no member has a box.
 */
export function boundsOfLayer(
  input: Pick<StructureInput, 'paintOrder' | 'memberBoundsOf'>,
  layer: { readonly open: number; readonly close: number },
): WorldBounds | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const id of input.paintOrder.slice(layer.open, layer.close + 1)) {
    const box = input.memberBoundsOf?.(id);
    if (box === undefined) continue;
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  return minX <= maxX && minY <= maxY ? { minX, minY, maxX, maxY } : undefined;
}

/**
 * Per rank, 1 when an object with opacity 0 holds it or encloses it: its own rank up to its
 * closing rank (a layer's composite; a leaf in multiply form has none and covers its own rank).
 *
 * @param input - The plan's input.
 * @returns The table.
 */
export function invisibleRanksOf(
  input: Pick<StructureInput, 'paintOrder' | 'invisibleIds' | 'rankById' | 'closingRankById'>,
): Uint8Array {
  const table = new Uint8Array(input.paintOrder.length);
  for (const id of input.invisibleIds) {
    const open = input.rankById.get(id);
    if (open === undefined) continue;
    table.fill(1, open, (input.closingRankById.get(id) ?? open) + 1);
  }
  return table;
}

/** The composites a window draws for its visible child layers. */
export interface WindowComposites {
  /** The composite entry (none without a visible child). */
  readonly entries: DrawListEntry[];
  /** The children's composite slots, ascending. */
  readonly slots: number[];
  /** Their bounds, in the same order. */
  readonly bounds: WorldBounds[];
}

/**
 * The composite entry of visible layers, their slots and their bounds in its order.
 *
 * @param children - The layers.
 * @param compositePassName - The composite pass's name.
 * @returns The composites.
 */
export function compositesOf(
  children: readonly PlanningLayer[],
  compositePassName: string,
): WindowComposites {
  const visible = children.filter((layer) => layer.isVisible).sort((a, b) => a.slot - b.slot);
  if (visible.length === 0) return { entries: [], slots: [], bounds: [] };
  const ranges = visible.map(({ slot }) => ({ start: slot, count: 1 }));
  return {
    entries: [{ passName: compositePassName, ranges }],
    slots: visible.map(({ slot }) => slot),
    bounds: visible.map(({ bounds }) => bounds ?? EVERYWHERE),
  };
}

/**
 * Whether a structure was made from the same tables, layers and fallbacks as this input asks.
 *
 * @param key - What it was made from.
 * @param input - The input.
 * @returns True when it still stands.
 */
function isSameStructure(key: StructureKey, input: StructureInput): boolean {
  const excluded = input.excludedLayers;
  if (!isSameTables(key, input)) return false;
  if (key.excludedRevision !== undefined || input.excludedRevision !== undefined) {
    return key.excludedRevision === input.excludedRevision;
  }
  return (
    key.excluded.size === (excluded?.size ?? 0) &&
    [...key.excluded].every((id) => excluded?.has(id) === true)
  );
}

/**
 * Whether two structures were made from the same tables, whatever their fallbacks: they differ
 * at most in which layers are planned.
 *
 * @param a - What one was made from.
 * @param b - What another was made from (or is asked).
 * @returns True when the tables are the same objects and sizes.
 */
export function isSameTables(
  a: StructureKey,
  b: Pick<StructureInput, 'paintOrder' | 'rankById' | 'closingRankById'> & {
    readonly layerSlots: ReadonlyMap<ObjectId, readonly number[]>;
    readonly invisibleIds: ReadonlySet<ObjectId>;
  },
): boolean {
  return (
    a.paintOrder === b.paintOrder &&
    a.rankById === b.rankById &&
    a.closingRankById === b.closingRankById &&
    a.layerSlots === b.layerSlots &&
    a.layerCount === b.layerSlots.size &&
    a.invisibleIds === b.invisibleIds &&
    a.invisibleCount === b.invisibleIds.size
  );
}

/**
 * Each layer, innermost first (closing rank ascending), with its parent's index; per rank the
 * innermost layer holding it (−1 for none); and the invisible ranks. Kept from the last plan
 * while its tables, layers and fallbacks are the same objects and sizes (the tables are live:
 * whoever changes their contents makes a new structure, `LayeredPlanCache.clear`). Each layer's
 * bounds are read again for this plan and its visibility reset.
 *
 * @param input - The plan's input.
 * @param previous - The last plan's structure.
 * @returns The structure.
 */
export function structureOf(
  input: StructureInput,
  previous: LayerStructure | undefined,
): LayerStructure {
  const structure =
    previous !== undefined && isSameStructure(previous.from, input)
      ? previous
      : build(input, previous);
  const { layerBounds, memberBoundsOf } = input;
  for (const layer of structure.layers) {
    layer.isVisible = false;
    // This frame's measure leaves out only layers that draw nothing (no box, or opacity 0).
    layer.bounds =
      memberBoundsOf === undefined
        ? EVERYWHERE
        : layerBounds === undefined
          ? boundsOfLayer(input, layer)
          : layerBounds.get(layer.id);
  }
  return structure;
}

/**
 * Makes a structure.
 *
 * @param input - The plan's input.
 * @param previous - The last plan's structure, whose invisible ranks stand while its tables do.
 * @returns The structure.
 */
function build(input: StructureInput, previous: LayerStructure | undefined): LayerStructure {
  // The layers and opacity 0 rest on the tables only, so a change of fallbacks keeps them.
  const isSame = previous !== undefined && isSameTables(previous.from, input);
  const { all, allByOpen } = isSame ? previous : allLayersOf(input);
  const excluded = input.excludedLayers;
  const indexOfAll = new Int32Array(all.length).fill(-1);
  const found: LayerSpanOf[] = [];
  all.forEach((layer, at) => {
    if (excluded?.has(layer.id) === true) return;
    indexOfAll[at] = found.length;
    found.push(layer);
  });
  const ownerOfRank = new Int32Array(input.paintOrder.length).fill(-1);
  const parents = new Int32Array(found.length).fill(-1);
  // Outermost first, so an inner layer overwrites its parent's ranks and reads its parent.
  for (const at of allByOpen) {
    const index = tableEntry(indexOfAll, at);
    const layer = found[index];
    if (layer === undefined) continue;
    parents[index] = tableEntry(ownerOfRank, layer.open);
    ownerOfRank.fill(index, layer.open, layer.close + 1);
  }
  const layers = found.map((layer, index): PlanningLayer => ({
    ...layer,
    index,
    parent: tableEntry(parents, index),
    isVisible: false,
    bounds: undefined,
  }));
  return {
    layers,
    ownerOfRank,
    all,
    allByOpen,
    invisible: isSame ? previous.invisible : invisibleRanksOf(input),
    from: {
      paintOrder: input.paintOrder,
      rankById: input.rankById,
      closingRankById: input.closingRankById,
      layerSlots: input.layerSlots,
      layerCount: input.layerSlots.size,
      invisibleIds: input.invisibleIds,
      invisibleCount: input.invisibleIds.size,
      excluded: input.excludedRevision === undefined ? new Set(input.excludedLayers) : new Set(),
      excludedRevision: input.excludedRevision,
    },
  };
}
