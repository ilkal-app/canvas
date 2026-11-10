import type { AssetId, ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import type { JobPriority } from '../workers/job-priority.js';

import type { AssetTileKey, ImageAssetInfo } from './asset-source.js';
import type { TrackedImage } from './image-index.js';
import type { LevelSource } from './level-loader.js';
import { levelSize, type Size } from './level-selection.js';
import type { TileAddress } from './tiles.js';

/**
 * The most tile records a tiled image has (after its whole-image record): enough for a
 * 4K display at twice the density with tiles drawn at half their size. When more tiles are
 * visible the manager uses a coarser tile level.
 */
export const MAX_TILE_PARTS = 512;

/** An image the viewport cares about, and how urgently. */
export interface ImageCandidate {
  /** The image. */
  readonly image: TrackedImage;
  /**
   * `visible` on screen, `near` in the padded viewport, `prefetch` where the pan is heading.
   * The candidate finder updates it in place as the view pans inside its padded search.
   */
  readonly priority: JobPriority;
}

/** One level an asset can show, as the planner reads it. */
export interface LevelEntry {
  /** Its long edge, px. */
  readonly longEdgePx: number;
  /** Its key (`levelKey`). */
  readonly key: string;
  /** Its GPU bytes (RGBA8). */
  readonly bytes: number;
}

/** A described asset as the planner sees it: built once per description, not per frame. */
export interface AssetView {
  /** Its description. */
  readonly info: ImageAssetInfo;
  /** Its original's size, px (known: an asset without one has no view). */
  readonly naturalSize: Size;
  /** The long edges it can show, smallest first (`showableLevels`). */
  readonly levels: readonly number[];
  /** Each level, smallest first, with its key and bytes. */
  readonly entries: readonly LevelEntry[];
  /** Its smallest level: the one every visible image always has. */
  readonly smallest: LevelEntry;
  /** Its largest level. */
  readonly largest: LevelEntry;
}

/**
 * Builds an asset's view for the planner: its levels with their keys and sizes.
 *
 * @param assetId - The asset.
 * @param info - Its description.
 * @param naturalSize - Its original's size, px.
 * @param levels - The long edges it can show, smallest first.
 * @returns The view.
 * @throws {RangeError} When there is no level: an asset with none has no view.
 */
export function assetView(
  assetId: AssetId,
  info: ImageAssetInfo,
  naturalSize: Size,
  levels: readonly number[],
): AssetView {
  const entries = levels.map((longEdgePx): LevelEntry => {
    const size = levelSize(naturalSize, longEdgePx);
    return { longEdgePx, key: levelKey(assetId, longEdgePx), bytes: size.width * size.height * 4 };
  });
  const [smallest] = entries;
  if (smallest === undefined) throw new RangeError(`Asset ${assetId} has no level to show.`);
  let largest = smallest;
  for (const entry of entries) largest = entry;
  return { info, naturalSize, levels, entries, smallest, largest };
}

/**
 * An asset's level with a long edge, or the largest below it: a level `pickLevel` or the budget
 * chose is always one of the view's.
 *
 * @param view - The asset.
 * @param longEdgePx - The level, px.
 * @returns The level's entry; the smallest when every level is larger.
 */
export function levelEntry(view: AssetView, longEdgePx: number): LevelEntry {
  let found = view.smallest;
  for (const entry of view.entries) if (entry.longEdgePx <= longEdgePx) found = entry;
  return found;
}

/** What the frame's needs are planned from. */
export interface NeedsInput {
  /** The images, visible first is not required. */
  readonly candidates: readonly ImageCandidate[];
  /**
   * A described asset.
   *
   * @param assetId - The asset.
   * @returns Its view, or undefined while it is not described.
   */
  assetOf(assetId: AssetId): AssetView | undefined;
  /**
   * What an object's plan was last frame: its picked level gives hysteresis, and an unchanged
   * plan is returned as the same object, so the caller can skip rebinding it. Absent: the
   * planner's own last plan (`ImagePlanner`).
   *
   * @param id - The object.
   * @returns The plan, or undefined.
   */
  previousPlan?(id: ObjectId): ObjectPlan | undefined;
  /**
   * Whether a level or tile is resident now: a tiled image stops wanting its largest level once
   * its visible tiles are all resident. Absent: nothing is.
   *
   * @param key - The key.
   * @returns True when resident.
   */
  isResident?(key: string): boolean;
  /** The camera zoom, CSS px per world unit. */
  readonly zoom: number;
  /** Device px per CSS px. */
  readonly dpr: number;
  /** The visible world rectangle: which tiles are visible. */
  readonly viewport: WorldBounds;
  /** The bytes the chosen levels may use together. */
  readonly budgetBytes: number;
}

/** A level or tile the frame wants resident. */
export interface Want {
  /** Its key (`levelKey`, `tileKey`). */
  readonly key: string;
  /** Where it comes from. */
  readonly source: LevelSource;
  /** The most urgent priority any image wants it at. */
  readonly priority: JobPriority;
  /** Whether a visible or near image needs it: then it is never evicted. */
  readonly isNeeded: boolean;
}

/** What one image object shows this frame. */
export interface ObjectPlan {
  /** Its smallest level's key. */
  readonly smallestKey: string;
  /** The level its on-screen size picked, before the budget: next frame's hysteresis. */
  readonly pickedLevel: number;
  /** The level it should show, long edge px (after the budget). */
  readonly level: number;
  /** That level's key. */
  readonly levelKey: string;
  /** The visible tiles and their keys, for a tiled image zoomed past its largest level. */
  readonly tiles:
    | readonly {
        /** Immutable tile resource key. */
        readonly key: string;
        /** Tile coordinates in the source image. */
        readonly address: TileAddress;
      }[]
    | undefined;
}

/**
 * The key of an asset's level.
 *
 * @param assetId - The asset.
 * @param longEdgePx - The level.
 * @returns The key.
 */
export function levelKey(assetId: AssetId, longEdgePx: number): string {
  return `${assetId}|L${String(longEdgePx)}`;
}

/**
 * Reads a level key (`levelKey`) back: its asset and long edge.
 *
 * @param key - A level or tile key.
 * @returns The asset and long edge, px; undefined for a tile key.
 */
export function parseLevelKey(key: string): { assetId: AssetId; longEdgePx: number } | undefined {
  const bar = key.indexOf('|');
  if (bar < 0 || key[bar + 1] !== 'L') return undefined;
  return { assetId: key.slice(0, bar) as AssetId, longEdgePx: Number(key.slice(bar + 2)) };
}

/**
 * The key of an asset's tile.
 *
 * @param assetId - The asset.
 * @param tile - The tile.
 * @returns The key.
 */
export function tileKey(assetId: AssetId, tile: AssetTileKey): string {
  return `${assetId}|T${String(tile.level)}/${String(tile.column)}/${String(tile.row)}`;
}

/**
 * The asset a level or tile key belongs to (`levelKey`, `tileKey`: the asset id, then `|`,
 * which no asset id contains).
 *
 * @param key - The key.
 * @returns The asset id.
 */
export function assetOfKey(key: string): AssetId {
  return key.slice(0, key.indexOf('|')) as AssetId;
}

/**
 * The largest level of an asset below a long edge that is resident: what an image shows while
 * that level is not (`shownLevel`).
 *
 * @param input - The planner's input: what is resident.
 * @param view - The asset.
 * @param longEdgePx - The level it wants, px.
 * @returns The level, or undefined when none below it is resident.
 */
export function residentLevelBelow(
  input: NeedsInput,
  view: AssetView,
  longEdgePx: number,
): LevelEntry | undefined {
  let found: LevelEntry | undefined;
  for (const entry of view.entries) {
    if (entry.longEdgePx >= longEdgePx) break;
    if (input.isResident?.(entry.key) === true) found = entry;
  }
  return found;
}
