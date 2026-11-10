import type { WorldBounds } from '@canvas/engine';

import { ALL_SNAP_EDGES, snapBox, type SnapEdges, type SnapGrid } from '../snap/snap-box.js';
import { gapsOf, type SnapGap } from '../snap/snap-gap.js';
import type { SnapGuide } from '../snap/snap-guide.js';

import { translateBox, worldBoundsOfBox, type OrientedBox } from './oriented-box.js';
import type { SelectIntent } from './select-intent.js';

/** A move drag's intent. */
export type MoveIntent = Extract<
  SelectIntent,
  {
    /** The move's discriminant. */
    readonly type: 'move';
  }
>;

/** A resize drag's intent. */
export type ResizeIntent = Extract<
  SelectIntent,
  {
    /** The resize's discriminant. */
    readonly type: 'resize';
  }
>;

/** A drag's transform intent: what snapping may adjust. */
export type TransformIntent = Extract<
  SelectIntent,
  {
    /** The transforms' discriminants. */
    readonly type: 'move' | 'resize' | 'rotate';
  }
>;

/**
 * The person's snapping preferences: per user, never in the document.
 */
export interface SnapSettings {
  /** Whether drags snap at all. */
  readonly isEnabled: boolean;
  /** Whether the dot grid shows: drags snap to it only then, so they land on dots one can see. */
  readonly isGridVisible: boolean;
}

/** No snapping: the select tool's default until the app passes the person's preferences. */
export const SNAPPING_OFF: SnapSettings = Object.freeze({ isEnabled: false, isGridVisible: false });

/** What a drag snaps against, for one pointer move. */
export interface DragSnapContext {
  /**
   * The boxes of the objects the dragged box may snap to (`snapCandidatesNear`).
   *
   * @param box - The dragged box before snapping, world units.
   * @returns The candidates, world units.
   */
  readonly candidatesNear: (box: WorldBounds) => readonly WorldBounds[];
  /** The snap threshold, world units (`snapThresholdAt`). */
  readonly thresholdWorld: number;
  /** The grid, when snapping to it. */
  readonly grid: SnapGrid | undefined;
}

/** A drag's intent after snapping, and the guides to show with it. */
export interface SnappedDrag<TIntent extends SelectIntent> {
  /** The intent, its displacement adjusted so the box lands on the lines it snapped to. */
  readonly intent: TIntent;
  /** The guides through those lines. */
  readonly guides: readonly SnapGuide[];
  /**
   * When it snapped to an object (there are guides), the runs to the box's nearest facing
   * neighbours (`gapsOf`); none if absent.
   */
  readonly gaps?: readonly SnapGap[];
}

/**
 * The gap runs a snapped box shows: around it, among the candidates it snapped
 * against, once it lies on an object's line; none otherwise, so a free drag shows no numbers.
 *
 * @param box - The box as it lands, world units.
 * @param candidates - The candidates it snapped against.
 * @param guides - The guides it shows.
 * @returns The runs.
 */
export function snappedGapsOf(
  box: WorldBounds,
  candidates: readonly WorldBounds[],
  guides: readonly SnapGuide[],
): readonly SnapGap[] {
  return guides.length > 0 ? gapsOf(box, candidates) : [];
}

/**
 * Snaps a move: the selection frame's bounds,
 * moved by the drag, snap by their edges and centre (`snapBox`), and the offset joins the
 * drag's displacement, so the preview, the overlay and the committed `moveObjects` all see the
 * snapped move. A Shift-locked move snaps along its one axis only. Pure.
 *
 * @param intent - The move so far.
 * @param start - The selection frame when the drag began, world units.
 * @param context - The candidates, the threshold and the grid.
 * @returns The snapped move, its guides and, when it snapped to an object, its gap runs.
 */
export function snapMove(
  intent: MoveIntent,
  start: OrientedBox,
  context: DragSnapContext,
): SnappedDrag<MoveIntent> {
  const moved = worldBoundsOfBox(translateBox(start, intent.delta));
  // `lockToAxis` keeps x on a tie, so a locked move with no y is along x.
  const edges: SnapEdges = !intent.isAxisLocked
    ? ALL_SNAP_EDGES
    : intent.delta.y === 0
      ? { x: ALL_SNAP_EDGES.x, y: [] }
      : { x: [], y: ALL_SNAP_EDGES.y };
  const candidates = context.candidatesNear(moved);
  const { delta, guides } = snapBox(moved, candidates, context.thresholdWorld, context.grid, edges);
  const snapped = { x: intent.delta.x + delta.x, y: intent.delta.y + delta.y };
  const landed = worldBoundsOfBox(translateBox(start, snapped));
  return {
    intent: { ...intent, delta: snapped },
    guides,
    gaps: snappedGapsOf(landed, candidates, guides),
  };
}
