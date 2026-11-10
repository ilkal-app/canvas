import type { WorldBounds } from '@canvas/engine';
import type { Rgba } from '@canvas/schema';

import type { SnapGap } from '../snap/snap-gap.js';
import { SNAP_GUIDE_COLOR, type SnapGuide } from '../snap/snap-guide.js';

import { countBadgeLayout } from './count-badge.js';
import { handleLayout, type ResizeAbility } from './handle-layout.js';
import type { OrientedBox } from './oriented-box.js';
import type { OverlayLabel } from './overlay-label.js';
import { dashedOutlineOf, gapRunOf, inBox, outlineOf, type OverlayRect } from './overlay-marks.js';
import type { OverlayPalette } from './overlay-palette.js';
import { MAX_OUTLINED_OBJECTS } from './selection-outlines.js';
import { thickenedLine } from './stack-reorder.js';
import {
  handleOf,
  styledHandlesOf,
  styledOutlineOf,
  type HandleColors,
} from './styled-selection.js';

export type { OverlayRect } from './overlay-marks.js';

/**
 * What the selection overlay shows: the selection frame with its
 * handles, the outline of each object in a multi-selection (or, above the outline cap, a badge
 * with the selection's count), the marquee being dragged, the frame a move would drop the
 * selection into, whether the selection is locked, the group
 * entered with a double-click, and whatever the active tool mode shows (a text caret and
 * selection, snap guides, pen handles) as flat rectangles.
 */
export interface SelectionOverlayModel {
  /** The selection frame, or undefined when nothing is selected. */
  readonly frame: OrientedBox | undefined;
  /**
   * Each selected object's own box, outlined when more than one is selected; empty above
   * `MAX_OUTLINED_OBJECTS` (`selectionOutlinesOf`), where `countBadge` stands in for them.
   */
  readonly outlines: readonly OrientedBox[];
  /**
   * The selection's size, shown in a badge below the frame instead of its outlines once they
   * are capped; undefined for no badge. A positive integer.
   */
  readonly countBadge: number | undefined;
  /**
   * Whether the resize handles show. There is no rotate handle: rotation starts from the bands
   * just outside the frame's corners, which are not drawn.
   */
  readonly canResize: ResizeAbility;
  /**
   * Whether every selected object is locked (`isLockedSelection`): the frame and outlines are
   * drawn in {@link LOCKED_COLOR} with a lock badge, and no handles show.
   */
  readonly isLocked: boolean;
  /** The marquee being dragged, world units, or undefined. */
  readonly marquee: WorldBounds | undefined;
  /**
   * During a move, the frame the primary object would land in on release, outlined
   * so the target is visible; undefined over bare board and outside a move.
   */
  readonly dropTarget: OrientedBox | undefined;
  /**
   * During a move inside, or into, a frame or main with a live auto-layout, the
   * line across its stack where the boxes would go on release: a box of no width (a row) or no
   * height (a column), drawn two CSS pixels thick in the selection colour; absent otherwise.
   */
  readonly insertion?: OrientedBox;
  /**
   * The entered group's derived box, outlined while clicks and marquees act inside
   * it; undefined at the board's top level.
   */
  readonly enteredGroup: OrientedBox | undefined;
  /**
   * The active tool mode's transient geometry: a text caret and selection highlight, snap guides,
   * pen handles, lock badges. Each is an oriented box and a colour, sized by the tool in world
   * units (CSS px divided by the zoom where it should keep a screen size); drawn after everything
   * else, in order. Plain data, so it crosses to the engine worker with the rest of the model.
   * Empty when there is none.
   */
  readonly toolRects: readonly OverlayRect[];
  /**
   * During a snapped move or resize, the guides through the lines the selection snapped to,
   * drawn one CSS pixel wide in red; absent or
   * empty otherwise.
   */
  readonly guides?: readonly SnapGuide[];
  /**
   * During a snapped move or resize, the runs from the selection to its nearest facing
   * neighbours, drawn as lines with end ticks in the guides' colour; absent or empty
   * otherwise. Their lengths are in `labels`.
   */
  readonly gaps?: readonly SnapGap[];
  /**
   * The object under a resting pointer that is not selected, outlined one pixel wide in
   * the palette's `hover`; absent when there is none.
   */
  readonly hover?: OrientedBox;
  /**
   * The editing states' colours for the viewer's theme, which the shell sends; with
   * one, guides and gap runs take its `guide`, the hover outline its `hover`, and a locked
   * selection is outlined dashed in its `locked`. Absent, the overlay keeps its own colours and
   * a solid lock outline.
   */
  readonly palette?: OverlayPalette;
  /**
   * Text the shell draws over the canvas as pills (`OverlayLabel`: the size readout, gap lengths,
   * the locked notice); the overlay's rectangles ignore them. Absent or empty for none.
   */
  readonly labels?: readonly OverlayLabel[];
}

/** Nothing to show. */
export const EMPTY_OVERLAY: SelectionOverlayModel = Object.freeze({
  frame: undefined,
  outlines: Object.freeze([]),
  countBadge: undefined,
  canResize: false,
  isLocked: false,
  marquee: undefined,
  dropTarget: undefined,
  enteredGroup: undefined,
  toolRects: Object.freeze([]),
});

/**
 * The selection colour: outlines and handle borders, the prototype's `OUTLINE_COLOR`
 * (0.2, 0.5, 1) in whole 8-bit steps, (51, 128, 255), so it reaches the canvas exactly and
 * pixel tests can compare it.
 */
export const SELECTION_COLOR: Rgba = [51 / 255, 128 / 255, 1, 1];

/**
 * The entered group's outline: the selection colour at half strength, in whole 8-bit steps,
 * so it reads as the scope around the selection rather than as a selected object.
 */
export const ENTERED_GROUP_COLOR: Rgba = [51 / 255, 128 / 255, 1, 128 / 255];

/** The inside of a handle, and the padlock drawn on the lock badge. */
export const HANDLE_FILL: Rgba = [1, 1, 1, 1];

/**
 * The outline colour of a locked selection, and its lock badge: a mid grey, (128, 128, 128) in
 * whole 8-bit steps, apart from the selection blue and readable on the light and dark canvas.
 */
export const LOCKED_COLOR: Rgba = [128 / 255, 128 / 255, 128 / 255, 1];

/** The lock badge's side, CSS px, whatever the zoom. */
export const LOCK_BADGE_SIZE_PX = 14;

/** The gap between a locked selection's frame and its lock badge, CSS px. */
export const LOCK_BADGE_GAP_PX = 4;

/**
 * The padlock on the lock badge, in badge px from its top-left corner: `[x, y, width, height]`
 * of the body and of the shackle's left post, right post and top bar.
 */
const PADLOCK_PX = [
  [3, 7, 8, 4],
  [4, 3, 1, 4],
  [9, 3, 1, 4],
  [4, 3, 6, 1],
] as const;

/** The classic handle: the selection blue round a white inside. */
const CLASSIC_HANDLE: HandleColors = { edge: SELECTION_COLOR, fill: HANDLE_FILL };

/** The fraction of the selection colour a marquee is filled with: about an eighth. */
const MARQUEE_ALPHA = 32 / 255;

/** The marquee's translucent fill: the selection colour at about an eighth. */
export const MARQUEE_FILL: Rgba = [51 / 255, 128 / 255, 1, MARQUEE_ALPHA];

/** The width of outlines and handle borders, CSS px, whatever the zoom. */
export const OUTLINE_WIDTH_PX = 1;

/** The width of an auto-layout insertion line, CSS px. */
export const INSERTION_WIDTH_PX = 2;

/**
 * The lock badge of a locked selection: a square in the lock colour just right of the frame's
 * top-right corner with a white padlock on it, turned with the frame, one screen size at every
 * zoom.
 *
 * @param frame - The selection frame.
 * @param zoom - The camera zoom, CSS px per world unit.
 * @returns The badge, then the padlock's four rectangles.
 */
function lockBadgeOf(frame: OrientedBox, zoom: number): OverlayRect[] {
  const px = 1 / zoom;
  const left = frame.width + LOCK_BADGE_GAP_PX * px;
  const size = LOCK_BADGE_SIZE_PX * px;
  return [
    { box: inBox(frame, left, 0, size, size), color: LOCKED_COLOR },
    ...PADLOCK_PX.map(([x, y, width, height]) => ({
      box: inBox(frame, left + x * px, y * px, width * px, height * px),
      color: HANDLE_FILL,
    })),
  ];
}

/**
 * A snapping guide as a strip one line wide, centred on its line, across its span.
 *
 * @param guide - The guide.
 * @param t - The strip width, world units.
 * @param color - The guides' colour: the palette's `guide`, else their red.
 * @returns The strip.
 */
function guideOf(guide: SnapGuide, t: number, color: Rgba): OverlayRect {
  const length = guide.to - guide.from;
  const box =
    guide.axis === 'x'
      ? { x: guide.position - t / 2, y: guide.from, width: t, height: length, rotation: 0 }
      : { x: guide.from, y: guide.position - t / 2, width: length, height: t, rotation: 0 };
  return { box, color };
}

/**
 * The selection's own rectangles: each outline of a multi-selection, the frame's outline (dashed
 * in the palette's `locked` when locked and themed), the guides and gap runs, the lock badge or
 * the handles, and the count badge.
 *
 * @param model - What to show.
 * @param frame - The selection frame.
 * @param zoom - The camera zoom, CSS px per world unit.
 * @param visible - The world the viewport shows, for the count badge.
 * @param dashWindow - Where a locked frame's dashes are cut (`dashWindowOf`); all of them if
 *   absent.
 * @returns The rectangles, in draw order.
 */
function selectionRectsOf(
  model: SelectionOverlayModel,
  frame: OrientedBox,
  zoom: number,
  visible: WorldBounds | undefined,
  dashWindow: WorldBounds | undefined,
): OverlayRect[] {
  const t = OUTLINE_WIDTH_PX / zoom;
  const { isLocked, palette, outlines } = model;
  const style = isLocked ? undefined : palette?.selection;
  const color = isLocked ? LOCKED_COLOR : (style?.color ?? SELECTION_COLOR);
  const rects: OverlayRect[] = [];
  const isCapped = outlines.length > MAX_OUTLINED_OBJECTS;
  const outlineColor = isLocked && palette ? palette.locked : color;
  if (outlines.length > 1 && !isCapped) {
    for (const box of outlines) rects.push(...outlineOf(box, t, outlineColor));
  }
  if (isLocked && palette) {
    rects.push(...dashedOutlineOf(frame, t, zoom, palette.locked, dashWindow));
  } else {
    rects.push(...(style ? styledOutlineOf(frame, zoom, style) : outlineOf(frame, t, color)));
  }
  const guideColor = palette?.guide ?? SNAP_GUIDE_COLOR;
  for (const guide of model.guides ?? []) rects.push(guideOf(guide, t, guideColor));
  for (const gap of model.gaps ?? []) rects.push(...gapRunOf(gap, t, zoom, guideColor));
  if (isLocked) rects.push(...lockBadgeOf(frame, zoom));
  if (style) rects.push(...styledHandlesOf(frame, zoom, model.canResize, style));
  const handles = isLocked || style ? [] : handleLayout(frame, zoom, model.canResize);
  for (const { centre, size } of handles) {
    rects.push(...handleOf(frame, centre, size, t, CLASSIC_HANDLE));
  }
  const count = model.countBadge ?? (isCapped ? outlines.length : undefined);
  if (count !== undefined) {
    const { badge, segments } = countBadgeLayout(frame, count, zoom, visible);
    rects.push({ box: badge, color });
    for (const box of segments) rects.push({ box, color: HANDLE_FILL });
  }
  return rects;
}

/**
 * The flat-colour rectangles that draw the overlay at a zoom (the prototype drew its selection
 * outline and handles as rectangles too, webgl-whiteboard `src/app/controller.ts`, `render`): the
 * entered group's outline (half-strength selection colour, one pixel) under everything,
 * the hover outline (the palette's `hover`, else the half-strength selection colour, one pixel,
 *), the drop target's outline (the selection colour, one pixel, just outside the frame:
 * the same blue reads on the light and the dark canvas), the marquee's fill and outline, each
 * object's outline in a multi-selection, the frame's outline, the snapping guides (red, one pixel,
 * centred on their lines) and the gap runs with their end ticks, then the resize handles
 * on top (no rotate handle: rotation starts from the undrawn bands outside the corners,
 * `hitRotationBand`), and last the count badge of a capped selection (`countBadgeLayout`), then
 * the tool mode's own rectangles on top, as given. A locked selection is outlined in the lock
 * colour (dashed, in the palette's `locked`, when the model has a palette) and shows a lock badge
 * instead of handles, and its count badge is in the lock colour too. The palette, when given, also
 * colours the guides and gap runs. Line widths and handle sizes are divided by the zoom, so they
 * keep one screen size. A model carrying more than `MAX_OUTLINED_OBJECTS` outlines is drawn as
 * capped, so the rectangles, rebuilt at every zoom a glide draws, never grow past the cap's.
 * Labels are not drawn here (the shell draws them). Pure.
 *
 * @param model - What to show.
 * @param zoom - The camera zoom, CSS px per world unit; greater than 0.
 * @param visible - The world the viewport shows, which the count badge stays inside; absent,
 *   the badge sits below the frame wherever that is.
 * @param dashWindow - Where a locked frame's dashes are cut (`dashWindowOf` of the view), so they
 *   stay bounded at any zoom; the whole outline if absent.
 * @returns The rectangles, in draw order; O(min(outlines, cap)), plus at most
 *   `MAX_LOCKED_DASHES` dashes of a locked frame's outline.
 */
export function overlayRectsOf(
  model: SelectionOverlayModel,
  zoom: number,
  visible?: WorldBounds,
  dashWindow?: WorldBounds,
): OverlayRect[] {
  const t = OUTLINE_WIDTH_PX / zoom;
  const rects: OverlayRect[] = model.enteredGroup
    ? outlineOf(model.enteredGroup, t, ENTERED_GROUP_COLOR)
    : [];
  if (model.hover) {
    rects.push(...outlineOf(model.hover, t, model.palette?.hover ?? ENTERED_GROUP_COLOR));
  }
  const style = model.palette?.selection;
  const accent = style?.color ?? SELECTION_COLOR;
  if (model.dropTarget) rects.push(...outlineOf(model.dropTarget, t, accent));
  if (model.insertion) {
    rects.push({
      box: thickenedLine(model.insertion, INSERTION_WIDTH_PX / zoom),
      color: accent,
    });
  }
  if (model.marquee) {
    const { minX, minY, maxX, maxY } = model.marquee;
    const box = { x: minX, y: minY, width: maxX - minX, height: maxY - minY, rotation: 0 };
    const [red, green, blue] = accent;
    const fill: Rgba = style ? [red, green, blue, MARQUEE_ALPHA] : MARQUEE_FILL;
    rects.push({ box, color: fill }, ...outlineOf(box, t, accent));
  }
  if (model.frame) {
    rects.push(...selectionRectsOf(model, model.frame, zoom, visible, dashWindow));
  }
  rects.push(...model.toolRects);
  return rects;
}
