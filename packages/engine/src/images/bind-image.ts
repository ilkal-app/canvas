import type { CatalogueEntry } from './asset-catalogue.js';
import {
  placeholderBinding,
  UNKNOWN_IMAGE_COLOR,
  WHOLE_IMAGE,
  type BindingPart,
  type ImageBinding,
  type ImageSource,
} from './image-binding.js';
import { levelKey, MAX_TILE_PARTS, type ObjectPlan } from './image-needs.js';
import { isTileable, type ResidencyImage } from './residency-image.js';
import type { ResidentLevel } from './texture-residency.js';

/** Long edge, px, above which an original has a tile pyramid: its objects get tile records. */
export const TILED_ORIGINAL_MIN_LONG_EDGE_PX = 4096;

/**
 * How many records an image object has in the image pass: one, or one per possible tile for an
 * image whose original is large enough to be tiled. A pure function of the object, as the z-order
 * segments need.
 *
 * @param object - The image object.
 * @returns The record count.
 */
export function imageRecordCount(object: ResidencyImage): number {
  // An image paint draws from pyramid levels only, never tiles.
  if (!isTileable(object)) return 1;
  const { width, height } = object.naturalSize;
  return Math.max(width, height) > TILED_ORIGINAL_MIN_LONG_EDGE_PX ? MAX_TILE_PARTS : 1;
}

/**
 * The resident level an image shows when it wants `target`: that level if resident, else the
 * largest resident one below it, else the smallest resident one above it. When only the
 * smallest level is below it, prefer the sharper level above up to 4x the target: another copy
 * may have replaced the wanted level to fit the budget. Larger reductions shimmer without
 * mipmaps, but an above-target level still draws when no lower level exists.
 *
 * @param entry - The asset.
 * @param target - The level wanted, long edge px.
 * @param residentOf - Looks up a resident level by key.
 * @returns The level to draw, or undefined when none is resident.
 */
export function shownLevel(
  entry: CatalogueEntry,
  target: number,
  residentOf: (key: string) => ResidentLevel | undefined,
): ResidentLevel | undefined {
  let below: ResidentLevel | undefined;
  let isBelowSmallest = false;
  let above: ResidentLevel | undefined;
  let aboveLongEdge = Infinity;
  for (const level of entry.levels) {
    const resident = residentOf(levelKey(entry.assetId, level));
    if (resident === undefined) continue;
    if (level === target) return resident;
    if (level < target) {
      below = resident;
      isBelowSmallest = level === entry.levels[0];
    }
    if (level > target && above === undefined) {
      above = resident;
      aboveLongEdge = level;
    }
  }
  return isBelowSmallest && aboveLongEdge <= target * 4 ? (above ?? below) : (below ?? above);
}

/**
 * What an image object draws this frame: its placeholder until its asset is described; then the
 * shown level for the whole crop, or, when the plan has visible tiles that fit its records, one
 * part per tile drawn from the tile when resident and from the shown level until then.
 *
 * @param object - The image object.
 * @param entry - Its asset's catalogue entry, if any.
 * @param plan - What this frame planned for it, if it is a candidate.
 * @param fallbackLevel - The level to show when there is no plan (last frame's), px.
 * @param residentOf - Looks up a resident level by key.
 * @returns The binding.
 */
export function bindImage(
  object: ResidencyImage,
  entry: CatalogueEntry | undefined,
  plan: ObjectPlan | undefined,
  fallbackLevel: number | undefined,
  residentOf: (key: string) => ResidentLevel | undefined,
): ImageBinding {
  const color = entry?.info?.averageColor ?? UNKNOWN_IMAGE_COLOR;
  if (entry?.status !== 'described') return placeholderBinding(color);
  const target = plan?.level ?? fallbackLevel ?? entry.levels[0] ?? 0;
  const base = shownLevel(entry, target, residentOf);
  const baseSource: ImageSource | undefined =
    base === undefined ? undefined : { region: base.region, covers: WHOLE_IMAGE };
  const tiles = plan?.tiles;
  if (tiles === undefined || tiles.length > imageRecordCount(object)) {
    return { color, parts: [{ rect: WHOLE_IMAGE, source: baseSource }] };
  }
  const parts = tiles.map(({ key, address }): BindingPart => {
    const tile = residentOf(key);
    return {
      rect: address.rect,
      source: tile === undefined ? baseSource : { region: tile.region, covers: address.rect },
    };
  });
  return { color, parts };
}
