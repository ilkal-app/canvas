import {
  placeOnSide,
  placePopover,
  type Placement,
  type PlacementRequest,
  type PlacementSide,
  type ScreenRect,
} from '../controls/placement.js';

/** Space between the selection's screen bounds and its popover, px (the design's frame A). */
export const SELECTION_POPOVER_GAP_PX = 14;

/** What {@link placeSelectionPopover} places. */
export interface SelectionPlacementRequest {
  /** The selection's bounds on screen. */
  readonly selection: ScreenRect;
  /** The popover's size. */
  readonly size: { readonly width: number; readonly height: number };
  /** The visible canvas. */
  readonly viewport: ScreenRect;
  /**
   * The board's visible objects on screen, not counting the selection's own (the spatial
   * index's results for the viewport): the popover prefers to cover less of them.
   */
  readonly objects: readonly ScreenRect[];
  /** What it must never cover: the dock, the zoom control, the facilitate card, the bars. */
  readonly reserved: readonly ScreenRect[];
  /** The page's direction; `ltr` if absent. */
  readonly direction?: 'ltr' | 'rtl' | undefined;
}

/**
 * The area two rectangles share, 0 when they only touch.
 *
 * @param a - One rectangle.
 * @param b - The other.
 * @returns The area, px².
 */
function overlapArea(a: ScreenRect, b: ScreenRect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** A clear placement on one side, with what it costs the board. */
interface Candidate {
  readonly placement: Placement;
  /** How much of the visible objects it covers, px². */
  readonly covered: number;
  /** How far its centre is from the viewport's, px. */
  readonly offCentre: number;
}

/**
 * The clear placement on a side, weighed.
 *
 * @param request - The selection's request.
 * @param base - The placement request built from it.
 * @param side - The side.
 * @returns The weighed placement, or undefined when the side has no clear spot.
 */
function candidateOn(
  request: SelectionPlacementRequest,
  base: PlacementRequest,
  side: PlacementSide,
): Candidate | undefined {
  const placement = placeOnSide(base, side);
  if (placement === undefined) return undefined;
  const rect = { x: placement.x, y: placement.y, ...request.size };
  const covered = request.objects.reduce((sum, object) => sum + overlapArea(rect, object), 0);
  const { viewport } = request;
  const offCentre = Math.hypot(
    rect.x + rect.width / 2 - (viewport.x + viewport.width / 2),
    rect.y + rect.height / 2 - (viewport.y + viewport.height / 2),
  );
  return { placement, covered, offCentre };
}

/**
 * The better of two weighed placements: the one covering less of the board, on a tie the one
 * nearer the screen's centre, on a second tie the first.
 *
 * @param a - One placement, if any.
 * @param b - The other, if any.
 * @returns The better one, or undefined when neither exists.
 */
function better(a: Candidate | undefined, b: Candidate | undefined): Candidate | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (a.covered !== b.covered) return a.covered < b.covered ? a : b;
  return b.offCentre < a.offCentre ? b : a;
}

/**
 * Where the properties popover goes beside the selection (the owner's rule
 * "whichever side covers less of the board and is closer to the center of the screen"):
 * above or below the selection's screen bounds, 14 px away, centred on it and held inside
 * the viewport, on the side that covers less of the board's visible objects, and on a tie the
 * side nearer the screen's centre; never over a reserved area (the dock, the zoom control,
 * the facilitate card, the board bar, the presence bar). When neither above nor below fits,
 * the left or the right side, weighed the same way; when nothing fits, the least bad spot
 * `placePopover` finds, marked as not clear. Pure.
 *
 * @param request - The selection, the popover's size, the viewport, the visible objects and
 *   the reserved areas.
 * @returns Where the popover's top left goes, its side and whether it fitted.
 */
export function placeSelectionPopover(request: SelectionPlacementRequest): Placement {
  const base: PlacementRequest = {
    anchor: request.selection,
    size: request.size,
    viewport: request.viewport,
    side: 'top',
    align: 'center',
    gap: SELECTION_POPOVER_GAP_PX,
    reserved: request.reserved,
    direction: request.direction ?? 'ltr',
  };
  const vertical = better(candidateOn(request, base, 'top'), candidateOn(request, base, 'bottom'));
  if (vertical !== undefined) return vertical.placement;
  const across = better(candidateOn(request, base, 'left'), candidateOn(request, base, 'right'));
  return across?.placement ?? placePopover(base);
}

/** What {@link followSelectionPopover} keeps the popover beside while the camera moves. */
export interface SelectionFollowRequest {
  /** The selection's bounds on screen. */
  readonly selection: ScreenRect;
  /** The popover's size, as measured when it was last placed. */
  readonly size: { readonly width: number; readonly height: number };
  /** The visible canvas. */
  readonly viewport: ScreenRect;
  /** What it must never cover, as measured when it was last placed. */
  readonly reserved: readonly ScreenRect[];
  /** The side it was last placed on. */
  readonly side: PlacementSide;
  /** The page's direction; `ltr` if absent. */
  readonly direction?: 'ltr' | 'rtl' | undefined;
}

/**
 * Where the properties popover goes while the camera moves (item 4): on the side it was
 * last placed on, 14 px from the selection's screen bounds, centred and held inside the
 * viewport, clear of the reserved areas; the nearest other side when that one has no room; none
 * when the selection has left the viewport, so it hides rather than parks at an edge. It weighs
 * no board objects, so a camera frame costs a few rectangles; `placeSelectionPopover` chooses
 * the side again once the camera stops. Pure.
 *
 * @param request - The selection, the popover's size, the viewport, the reserved areas and the
 *   side it is on.
 * @returns Where its top left goes, or undefined when the selection is off screen.
 */
export function followSelectionPopover(request: SelectionFollowRequest): Placement | undefined {
  const { selection, viewport } = request;
  const isOnScreen =
    selection.x <= viewport.x + viewport.width &&
    selection.x + selection.width >= viewport.x &&
    selection.y <= viewport.y + viewport.height &&
    selection.y + selection.height >= viewport.y;
  if (!isOnScreen) return undefined;
  const base: PlacementRequest = {
    anchor: selection,
    size: request.size,
    viewport,
    side: request.side,
    align: 'center',
    gap: SELECTION_POPOVER_GAP_PX,
    reserved: request.reserved,
    direction: request.direction ?? 'ltr',
  };
  return placeOnSide(base, request.side) ?? placePopover(base);
}
