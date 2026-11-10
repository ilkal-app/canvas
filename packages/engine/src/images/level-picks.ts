import type { AssetId, ObjectId } from '@canvas/schema';

import {
  levelEntry,
  type AssetView,
  type ImageCandidate,
  type LevelEntry,
  type NeedsInput,
  type ObjectPlan,
} from './image-needs.js';
import { fitLevelsToBudget, type LevelChoice } from './level-budget.js';
import {
  LEVEL_DOWN_RATIO,
  LEVEL_UP_SLACK,
  pickLevel,
  requiredLongEdgePx,
} from './level-selection.js';

/** The pick of a candidate whose asset is not described. */
const NO_LEVEL: LevelEntry = { longEdgePx: 0, key: '', bytes: 0 };

/** One candidate's level before the budget. */
export interface LevelPick {
  /** The candidate. */
  candidate: ImageCandidate;
  /** Its asset, or undefined while it is not described. */
  view: AssetView | undefined;
  /** Its last plan. */
  previous: ObjectPlan | undefined;
  /** The level its on-screen size picked, with hysteresis; meaningless without a view. */
  picked: LevelEntry;
  /** The long edge it needs, px. */
  required: number;
}

/**
 * Each candidate's level before the budget, in candidate order: its asset's view, its last plan,
 * the long edge it needs (on-screen size × DPR) and the level that picks, with hysteresis from the
 * last plan. The picks are kept between plans and overwritten in place, so picking allocates
 * nothing per image once the candidates stop growing. On the thread that renders.
 */
export class LevelPicks {
  /** One pick per candidate of the last `pick`, in order. */
  readonly picks: LevelPick[] = [];
  /** The bytes the last pick's ideal levels take, before fitting to the budget. */
  wantedBytes = 0;
  private lowerScale = Infinity;
  private upperScale = 0;

  /**
   * Proves every previous pick remains within its hysteresis band, before budget fitting.
   *
   * @param scale - Zoom times device pixel ratio.
   * @returns Whether scale alone cannot change any pick or introduce tiles.
   */
  canReuseScale(scale: number): boolean {
    // Stay strictly inside the bounds, with a margin for the division used to derive them.
    return scale > this.lowerScale * (1 + 1e-12) && scale < this.upperScale * (1 - 1e-12);
  }

  /**
   * Picks every candidate's level, and, when the picks might not fit the budget, the largest
   * level the budget leaves each asset. Counting every image's pick, even images sharing an
   * asset, bounds the bytes from above: when that fits the budget no fitting is needed, the
   * common case, and nothing is allocated.
   *
   * @param input - The planner's input.
   * @param lastPlan - An image's last plan, when `input.previousPlan` is absent.
   * @returns The fitted long edge per asset id, or undefined when the picks fit.
   */
  pick(
    input: NeedsInput,
    lastPlan: (id: ObjectId) => ObjectPlan | undefined,
  ): Map<string, number> | undefined {
    let upperBytes = 0;
    this.lowerScale = 0;
    this.upperScale = Infinity;
    input.candidates.forEach((candidate, index) => {
      const pick = this.pickAt(index, candidate);
      const { object } = candidate.image;
      const view = input.assetOf(object.assetId);
      pick.view = view;
      pick.previous = undefined;
      pick.picked = NO_LEVEL;
      if (view === undefined) return;
      const plan = input.previousPlan?.(object.id) ?? lastPlan(object.id);
      const need = requiredLongEdgePx(object, view.naturalSize, object.crop, input.zoom, input.dpr);
      const picked = levelEntry(view, pickLevel(need, view.levels, plan?.pickedLevel));
      pick.previous = plan;
      pick.picked = picked;
      pick.required = need;
      upperBytes += picked.bytes;
      this.constrainScale(view, picked.longEdgePx, need, input.zoom * input.dpr);
    });
    this.picks.length = input.candidates.length;
    this.wantedBytes = upperBytes;
    return upperBytes > input.budgetBytes ? this.fit(input) : undefined;
  }

  private constrainScale(view: AssetView, picked: number, required: number, scale: number): void {
    if (required === 0) return;
    const index = view.levels.indexOf(picked);
    const below = view.levels[index - 1] ?? 0;
    this.lowerScale = Math.max(this.lowerScale, ((below * LEVEL_DOWN_RATIO) / required) * scale);
    if (index < view.levels.length - 1) {
      this.upperScale = Math.min(
        this.upperScale,
        ((picked * (1 + LEVEL_UP_SLACK)) / required) * scale,
      );
    }
    if (view.info.tiles !== null) {
      this.upperScale = Math.min(this.upperScale, (view.largest.longEdgePx / required) * scale);
    }
  }

  private pickAt(index: number, candidate: ImageCandidate): LevelPick {
    const existing = this.picks[index];
    if (existing !== undefined) {
      existing.candidate = candidate;
      return existing;
    }
    const pick: LevelPick = {
      candidate,
      view: undefined,
      previous: undefined,
      picked: NO_LEVEL,
      required: 0,
    };
    this.picks[index] = pick;
    return pick;
  }

  /**
   * The largest level the budget leaves each asset (`fitLevelsToBudget`), counting each asset
   * once at the largest pick of its images. Allocates per asset.
   *
   * @param input - The planner's input.
   * @returns The fitted long edge per asset id.
   */
  private fit(input: NeedsInput): Map<string, number> {
    const choices = new Map<AssetId, LevelChoice>();
    for (const { candidate, view, picked } of this.picks) {
      if (view === undefined) continue;
      const { assetId } = candidate.image.object;
      const level = picked.longEdgePx;
      const choice = choices.get(assetId);
      if (choice === undefined || choice.chosen < level) {
        const bytesOf = (edge: number): number => levelEntry(view, edge).bytes;
        choices.set(assetId, { assetId, levels: view.levels, chosen: level, bytesOf });
      }
    }
    return fitLevelsToBudget([...choices.values()], input.budgetBytes);
  }
}
