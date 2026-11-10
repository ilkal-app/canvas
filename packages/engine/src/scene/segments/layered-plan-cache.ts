import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../../camera/camera.js';
import type { DrawListEntry } from '../draw-list.js';

import { isSameDrawList } from './draw-list-snapshot.js';
import type { LayerStructure } from './layer-structure.js';
import { LayeredCoverage } from './layered-coverage.js';
import type { SegmentPlan } from './segment-plan.js';
import type { SegmentWindows } from './segment-windows.js';

/** What one window (a layer's, or the canvas's) was planned from, and its plan. */
export interface PlannedWindow {
  /** Its visible records and child composites, as the planner took them. */
  readonly visible: readonly DrawListEntry[];
  /** Its visible child layers' composite slots, ascending. */
  readonly childSlots: readonly number[];
  /** Its visible child layers' bounds, in the order of their composites. */
  readonly childBounds: readonly WorldBounds[];
  /** Its own rank and its closing one (the canvas: 0 and −1). */
  readonly open: number;
  /** See {@link PlannedWindow.open}. */
  readonly close: number;
  /** The plan. */
  readonly plan: SegmentPlan;
  /** Its entries in the frame's draw list: a layer's tagged with its id. */
  readonly entries: readonly DrawListEntry[];
}

/** What a window is planned from this time. */
export type WindowRequest = Omit<PlannedWindow, 'plan' | 'entries'>;

/** The canvas's key among the windows. */
const CANVAS = '';

/**
 * Whether two lists of bounds are equal, value by value.
 *
 * @param a - One list.
 * @param b - Another.
 * @returns True when equal.
 */
function isSameBounds(a: readonly WorldBounds[], b: readonly WorldBounds[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((bounds, index) => {
    const other = b[index];
    return (
      other?.minX === bounds.minX &&
      other.minY === bounds.minY &&
      other.maxX === bounds.maxX &&
      other.maxY === bounds.maxY
    );
  });
}

/**
 * Whether a kept window has the same ranks and child composites (slots and bounds) as asked.
 *
 * @param window - The kept window.
 * @param request - What is asked.
 * @returns True when they are the same.
 */
export function isSameFrame(
  window: PlannedWindow,
  request: Pick<WindowRequest, 'childSlots' | 'childBounds' | 'open' | 'close'>,
): boolean {
  return (
    window.open === request.open &&
    window.close === request.close &&
    window.childSlots.length === request.childSlots.length &&
    window.childSlots.every((slot, index) => slot === request.childSlots[index]) &&
    isSameBounds(window.childBounds, request.childBounds)
  );
}

/**
 * The composites a kept window must add and remove to draw a new set, by slot; undefined when a
 * composite it keeps changed bounds (its plan merged by the old ones).
 *
 * @param window - The kept window.
 * @param request - The composites now.
 * @returns The slots added and removed.
 */
export function compositeChangeOf(
  window: PlannedWindow,
  request: Pick<WindowRequest, 'childSlots' | 'childBounds'>,
): { added: number[]; removed: number[] } | undefined {
  const was = new Map(window.childSlots.map((slot, index) => [slot, window.childBounds[index]]));
  const added: number[] = [];
  for (const [index, slot] of request.childSlots.entries()) {
    const bounds = request.childBounds[index];
    const old = was.get(slot);
    if (!was.delete(slot)) added.push(slot);
    else if (old === undefined || bounds === undefined || !isSameBounds([old], [bounds])) {
      return undefined;
    }
  }
  return { added, removed: [...was.keys()] };
}

/**
 * The z-order segments' layered plans kept window by window: a window (a layer's,
 * or the canvas's) is planned again only when its visible records or child composites, its
 * children's bounds or its ranks changed, or when it was forgotten (a member moved or changed
 * its level-of-detail form: `forget`); otherwise its last plan is used again. It also keeps the
 * windows' layout (`structure`), their visible records (`coverage`) and the canvas's interval
 * cache (`canvasWindows`). Everything else a window's plan rests on (the paint order, slot
 * owners, occluders, pages, opacity 0, drawing bounds, planning with or without boxes) clears
 * it all (`clear`). The frame's thread.
 */
export class LayeredPlanCache {
  /** The last plan's layers and rank owners. */
  structure: LayerStructure | undefined;
  /** The windows' visible records, kept from plan to plan. */
  readonly coverage = new LayeredCoverage();
  /** The canvas plan's interval cache, patched for coverage changes on the canvas. */
  canvasWindows: SegmentWindows | undefined;
  /** The last plan's layer bounds by composite rank, read live by the plans' boxes. */
  boundsByRank: ReadonlyMap<number, WorldBounds> = new Map();
  private readonly windows = new Map<string, PlannedWindow>();
  private isWithoutBoxes: boolean | undefined;
  private planned = 0;

  /**
   * How many windows were planned anew since the last {@link LayeredPlanCache.begin}.
   *
   * @returns The count.
   */
  get plannedCount(): number {
    return this.planned;
  }

  /**
   * A window's last plan, if kept.
   *
   * @param layer - The layer, or undefined for the canvas.
   * @returns The window.
   */
  get(layer: ObjectId | undefined): PlannedWindow | undefined {
    return this.windows.get(layer ?? CANVAS);
  }

  /**
   * Forgets one window.
   *
   * @param layer - The layer, or undefined for the canvas.
   */
  forget(layer: ObjectId | undefined): void {
    this.windows.delete(layer ?? CANVAS);
    if (layer === undefined) this.canvasWindows = undefined;
  }

  /** Forgets everything: something every plan rests on changed. */
  clear(): void {
    this.windows.clear();
    this.structure = undefined;
    this.coverage.clear();
    this.canvasWindows = undefined;
  }

  /**
   * Starts a layered plan.
   *
   * @param isWithoutBoxes - Whether it merges by passes only: plans by boxes are not reused then.
   */
  begin(isWithoutBoxes: boolean): void {
    if (this.isWithoutBoxes !== isWithoutBoxes) {
      this.windows.clear();
      this.canvasWindows = undefined;
    }
    this.isWithoutBoxes = isWithoutBoxes;
    this.planned = 0;
  }

  /**
   * Keeps a window's plan as given.
   *
   * @param layer - The layer, or undefined for the canvas.
   * @param request - What it was planned from.
   * @param plan - Its plan.
   * @returns The kept window.
   */
  keep(layer: ObjectId | undefined, request: WindowRequest, plan: SegmentPlan): PlannedWindow {
    const window: PlannedWindow = {
      ...request,
      plan,
      entries:
        layer === undefined ? plan.entries : plan.entries.map((entry) => ({ ...entry, layer })),
    };
    this.windows.set(layer ?? CANVAS, window);
    return window;
  }

  /**
   * A window's plan: the last one when nothing it rests on changed, else a new one.
   *
   * @param layer - The layer, or undefined for the canvas.
   * @param request - What the window is planned from.
   * @param plan - Plans it.
   * @returns The window's plan and entries.
   */
  window(
    layer: ObjectId | undefined,
    request: WindowRequest,
    plan: () => SegmentPlan,
  ): PlannedWindow {
    const cached = this.windows.get(layer ?? CANVAS);
    if (
      cached !== undefined &&
      isSameFrame(cached, request) &&
      isSameDrawList(cached.visible, request.visible)
    ) {
      return cached;
    }
    if (layer === undefined) this.canvasWindows = undefined;
    this.planned += 1;
    return this.keep(layer, request, plan());
  }

  /**
   * Forgets the windows of layers that are no longer planned.
   *
   * @param isPlanned - Whether a layer is still planned.
   */
  retain(isPlanned: (layer: ObjectId) => boolean): void {
    for (const key of this.windows.keys()) {
      if (key !== CANVAS && !isPlanned(key as ObjectId)) this.windows.delete(key);
    }
  }
}
