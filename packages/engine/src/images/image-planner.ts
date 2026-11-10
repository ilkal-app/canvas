import { fittedImageRect, type AssetId, type ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import { priorityRank, type JobPriority } from '../workers/job-priority.js';

import { isServerLevel } from './asset-catalogue.js';
import type { ImageAssetInfo } from './asset-source.js';
import type { TrackedImage } from './image-index.js';
import {
  levelEntry,
  residentLevelBelow,
  MAX_TILE_PARTS,
  tileKey,
  type AssetView,
  type LevelEntry,
  type NeedsInput,
  type ObjectPlan,
  type Want,
} from './image-needs.js';
import type { LevelSource } from './level-loader.js';
import { LevelPicks, type LevelPick } from './level-picks.js';
import { isTileable } from './residency-image.js';
import { pickTileLevel, tilesCovering, visibleImageRect, type TileAddress } from './tiles.js';

/** A want the planner keeps between plans: revived, not reallocated, while its key is wanted. */
interface WantSlot extends Want {
  source: LevelSource;
  priority: JobPriority;
  isNeeded: boolean;
  /** The plan that last wanted it. */
  stamp: number;
  /** The description its source was made from: a new one may turn a client level into a server one. */
  info: ImageAssetInfo | undefined;
}

/** A plan the planner keeps between plans. */
interface PlanSlot {
  plan: ObjectPlan;
  /** The plan that last planned its image. */
  stamp: number;
}

function levelSource(assetId: AssetId, info: ImageAssetInfo, longEdgePx: number): LevelSource {
  return isServerLevel(info, longEdgePx)
    ? { kind: 'server', assetId, longEdgePx }
    : { kind: 'client', assetId, longEdgePx, mimeType: info.mimeType };
}

/**
 * The visible tiles of a tiled image zoomed past its largest level, at the coarsest tile level
 * that meets the requirement (with the levels' hysteresis, from the tile level it showed last),
 * or coarser while more than {@link MAX_TILE_PARTS} are visible.
 *
 * @param image - The image.
 * @param view - Its asset.
 * @param required - The long edge it needs, px.
 * @param previous - Its last plan: the tile level it showed.
 * @param viewport - The visible world rectangle.
 * @returns The tiles, or undefined when the image shows a level instead.
 */
function visibleTiles(
  image: TrackedImage,
  view: AssetView,
  required: number,
  previous: ObjectPlan | undefined,
  viewport: WorldBounds,
): TileAddress[] | undefined {
  const { naturalSize } = view;
  const { tiles } = view.info;
  const { object, transform } = image;
  if (tiles === null) return undefined;
  const region = visibleImageRect(fittedImageRect(object), transform, object.crop, viewport);
  if (region === null) return undefined;
  const shown = previous?.tiles?.[0]?.address.level;
  for (let level = pickTileLevel(required, naturalSize, tiles, shown); level >= 0; level -= 1) {
    const covering = tilesCovering(region, naturalSize, tiles, level);
    if (covering.length <= MAX_TILE_PARTS) return covering;
  }
  return undefined;
}

/**
 * Plans the frame's residency: for every candidate
 * image of a described asset, its smallest level (always), the level its on-screen size × DPR
 * calls for (with hysteresis, then lowered where the chosen levels would not fit the budget
 * together) and, for a visible tiled image zoomed past its largest level, its visible tiles
 * (with the same hysteresis on the tile level), wanting its largest level too only until those
 * tiles are resident. Each want carries the most urgent priority asking for it.
 *
 * It decides; the texture manager acts. Between plans it keeps its wants, plans and scratch
 * arrays and revives them in place, so a plan allocates only for a new key, a changed plan or
 * visible tiles, never per image (per-frame CPU is bounded; `texture-manager.bench.ts`). An
 * unchanged plan stays the same object. Over the budget, fitting the levels allocates per asset. On
 * the thread that renders.
 */
export class ImagePlanner {
  private readonly wantSlots = new Map<string, WantSlot>();
  private readonly planSlots = new Map<ObjectId, PlanSlot>();
  private readonly changedIds: ObjectId[] = [];
  private stamp = 0;
  private tileCandidates = 0;
  private readonly picks = new LevelPicks();

  /**
   * What the last plan wants resident, by key: live, revived by the next plan.
   *
   * @returns The wants.
   */
  get wants(): ReadonlyMap<string, Want> {
    return this.wantSlots;
  }

  /**
   * The bytes the last planned picks' ideal levels take, before fitting to the budget.
   *
   * @returns Bytes.
   */
  get wantedBytes(): number {
    return this.picks.wantedBytes;
  }

  /**
   * The images whose plan the last plan changed (a new plan object): the ones to rebind.
   *
   * @returns Their ids; reused by the next plan.
   */
  get changed(): readonly ObjectId[] {
    return this.changedIds;
  }

  /**
   * Whether a candidate of the last plan may show tiles: a tiled image zoomed past its largest
   * level, at any priority. Its visible tiles move with any pan, and a near or prefetch one gets
   * tiles only once a plan sees it on screen, so no pan may skip planning while one exists.
   *
   * @returns True when one does.
   */
  get hasTileCandidates(): boolean {
    return this.tileCandidates > 0;
  }

  /**
   * Proves a zoom keeps the previous candidates' level picks and cannot introduce tiles.
   *
   * @param scale - Zoom times device pixel ratio.
   * @returns Whether the last plan's scale interval contains this scale.
   */
  canReuseScale(scale: number): boolean {
    return this.picks.canReuseScale(scale);
  }

  /**
   * An image's plan from the last plan.
   *
   * @param id - The object.
   * @returns Its plan, or undefined when it was not a candidate.
   */
  planOf(id: ObjectId): ObjectPlan | undefined {
    return this.planSlots.get(id)?.plan;
  }

  /**
   * Every plan of the last plan, by object.
   *
   * @returns A new map.
   */
  plans(): Map<ObjectId, ObjectPlan> {
    return new Map([...this.planSlots].map(([id, { plan }]) => [id, plan]));
  }

  /**
   * Forgets an image's plan: it left the scene, and a new object of the same id starts afresh.
   *
   * @param id - The object.
   */
  forget(id: ObjectId): void {
    this.planSlots.delete(id);
  }

  /**
   * Plans a frame: afterwards `wants` holds what it wants resident, `planOf` each candidate's
   * plan and `changed` the images whose plan changed. Wants and plans of images no longer
   * candidates are dropped.
   *
   * @param input - The candidates, their assets, the camera, the budget and residency.
   */
  plan(input: NeedsInput): void {
    this.stamp += 1;
    this.changedIds.length = 0;
    this.tileCandidates = 0;
    const fitted = this.picks.pick(input, (id) => this.planSlots.get(id)?.plan);
    for (const pick of this.picks.picks) {
      const { view, picked, candidate } = pick;
      if (view === undefined) continue;
      const isTiling = isTileable(candidate.image.object);
      if (isTiling && view.info.tiles !== null && pick.required > view.largest.longEdgePx) {
        this.tileCandidates += 1;
      }
      const budgetLevel = fitted?.get(candidate.image.object.assetId) ?? picked.longEdgePx;
      const shown = budgetLevel < picked.longEdgePx ? levelEntry(view, budgetLevel) : picked;
      this.keep(candidate.image.object.id, this.planCandidate(input, pick, view, shown));
    }
    this.dropStale();
  }

  /**
   * Revives a want's slot for this plan (reset to this image's priority and need) the first time
   * the plan asks for its key, else raises it to this image's priority and need.
   *
   * @param slot - The slot.
   * @param priority - How urgently this image wants it.
   * @param isNeeded - Whether this image needs it now.
   * @returns Whether it was revived (its source may be stale).
   */
  private revive(slot: WantSlot, priority: JobPriority, isNeeded: boolean): boolean {
    if (slot.stamp !== this.stamp) {
      slot.stamp = this.stamp;
      slot.priority = priority;
      slot.isNeeded = isNeeded;
      return true;
    }
    if (priorityRank(priority) < priorityRank(slot.priority)) slot.priority = priority;
    slot.isNeeded ||= isNeeded;
    return false;
  }

  /**
   * Wants one level of an asset for one image.
   *
   * @param key - The level's key.
   * @param assetId - The asset.
   * @param info - Its description: whether the server made the level.
   * @param longEdgePx - The level.
   * @param priority - How urgently this image wants it.
   * @param isNeeded - Whether this image needs it now.
   */
  private wantLevel(
    key: string,
    assetId: AssetId,
    info: ImageAssetInfo,
    longEdgePx: number,
    priority: JobPriority,
    isNeeded: boolean,
  ): void {
    const slot = this.wantSlots.get(key);
    if (slot === undefined) {
      const source = levelSource(assetId, info, longEdgePx);
      this.wantSlots.set(key, { key, source, priority, isNeeded, stamp: this.stamp, info });
    } else if (this.revive(slot, priority, isNeeded) && slot.info !== info) {
      // A new description may have turned a client level into a server one.
      slot.info = info;
      slot.source = levelSource(assetId, info, longEdgePx);
    }
  }

  /**
   * Wants one tile of an asset for one image.
   *
   * @param key - The tile's key.
   * @param assetId - The asset.
   * @param address - The tile.
   * @param priority - How urgently this image wants it.
   * @param isNeeded - Whether this image needs it now.
   */
  private wantTile(
    key: string,
    assetId: AssetId,
    address: TileAddress,
    priority: JobPriority,
    isNeeded: boolean,
  ): void {
    const slot = this.wantSlots.get(key);
    if (slot !== undefined) {
      this.revive(slot, priority, isNeeded);
      return;
    }
    const { level, column, row, widthPx, heightPx } = address;
    const tile = { level, column, row };
    const source: LevelSource = {
      kind: 'tile',
      assetId,
      tile,
      longEdgePx: Math.max(widthPx, heightPx),
    };
    this.wantSlots.set(key, {
      key,
      source,
      priority,
      isNeeded,
      stamp: this.stamp,
      info: undefined,
    });
  }

  /**
   * Adds one candidate's wants and returns its plan: last plan's object when nothing about it
   * changed.
   *
   * @param input - The planner's input: the viewport, and what is resident.
   * @param pick - The candidate, its need, last plan and picked level.
   * @param view - Its asset.
   * @param shown - The level it shows, after the budget.
   * @returns What the image shows.
   */
  private planCandidate(
    input: NeedsInput,
    pick: LevelPick,
    view: AssetView,
    shown: LevelEntry,
  ): ObjectPlan {
    const { candidate, previous, required } = pick;
    const picked = pick.picked.longEdgePx;
    const { image, priority } = candidate;
    const { assetId } = image.object;
    const { info, smallest } = view;
    const isNeeded = priority !== 'prefetch';
    const level = shown.longEdgePx;
    const { key } = shown;
    const smallestKey = smallest.key;
    this.wantLevel(smallestKey, assetId, info, smallest.longEdgePx, priority, isNeeded);
    // An image paint draws from pyramid levels only, never tiles.
    const addresses =
      priority === 'visible' && required > view.largest.longEdgePx && isTileable(image.object)
        ? visibleTiles(image, view, required, previous, input.viewport)
        : undefined;
    if (addresses === undefined) {
      if (key !== smallestKey) this.wantLevel(key, assetId, info, level, priority, isNeeded);
      // Until the level is resident the image shows the largest resident one below it: kept
      // wanted, so a level waiting to load or to fit the budget (a refused original) never costs
      // the image the level it shows meanwhile.
      const meanwhile =
        input.isResident?.(key) === false ? residentLevelBelow(input, view, level) : undefined;
      if (meanwhile !== undefined && meanwhile.key !== smallestKey) {
        this.wantLevel(meanwhile.key, assetId, info, meanwhile.longEdgePx, priority, isNeeded);
      }
      const isUnchanged =
        previous?.tiles === undefined &&
        previous?.levelKey === key &&
        previous.smallestKey === smallestKey &&
        previous.pickedLevel === picked;
      return isUnchanged
        ? previous
        : { smallestKey, pickedLevel: picked, level, levelKey: key, tiles: undefined };
    }
    const tiles = addresses.map((address) => ({ key: tileKey(assetId, address), address }));
    // The largest level shows where a tile has not arrived, so it is wanted first; once every
    // visible tile is resident it is not needed, and an idle level may be evicted.
    const isEveryTileResident = tiles.every(({ key: tile }) => input.isResident?.(tile) === true);
    if (!isEveryTileResident) this.wantLevel(key, assetId, info, level, priority, isNeeded);
    for (const { key: tileWantKey, address } of tiles) {
      this.wantTile(tileWantKey, assetId, address, priority, isNeeded);
    }
    return { smallestKey, pickedLevel: picked, level, levelKey: key, tiles };
  }

  private keep(id: ObjectId, plan: ObjectPlan): void {
    const slot = this.planSlots.get(id);
    if (slot === undefined) {
      this.planSlots.set(id, { plan, stamp: this.stamp });
      this.changedIds.push(id);
      return;
    }
    slot.stamp = this.stamp;
    if (slot.plan === plan) return;
    slot.plan = plan;
    this.changedIds.push(id);
  }

  /** Drops the wants and plans this plan did not revive. */
  private dropStale(): void {
    for (const [key, slot] of this.wantSlots) {
      if (slot.stamp !== this.stamp) this.wantSlots.delete(key);
    }
    for (const [id, slot] of this.planSlots) {
      if (slot.stamp !== this.stamp) this.planSlots.delete(id);
    }
  }
}

/**
 * Plans one frame from scratch (`ImagePlanner`), for tests and one-off callers: what it wants
 * resident, by key, and what each image shows. Pure: last frame's plans come from
 * `input.previousPlan`.
 *
 * @param input - The candidates, their assets, the camera and the budget.
 * @returns The wants and the plans.
 */
export function planImageNeeds(input: NeedsInput): {
  wants: Map<string, Want>;
  plans: Map<ObjectId, ObjectPlan>;
} {
  const planner = new ImagePlanner();
  planner.plan(input);
  return { wants: new Map(planner.wants), plans: planner.plans() };
}
