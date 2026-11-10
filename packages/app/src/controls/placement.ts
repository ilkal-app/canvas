/** A rectangle on screen, in CSS pixels from the viewport's top left. */
export interface ScreenRect {
  /** Its left edge. */
  readonly x: number;
  /** Its top edge. */
  readonly y: number;
  /** Its width. */
  readonly width: number;
  /** Its height. */
  readonly height: number;
}

/** The side of its anchor a popover opens on. */
export type PlacementSide = 'top' | 'bottom' | 'left' | 'right';

/**
 * Where a popover lines up along its anchor's edge: its start edge with the anchor's start
 * (`start`; the left in a left-to-right page, the right in a right-to-left one), the centres
 * (`center`), or the end edges (`end`). On the left and right sides, start is the top.
 */
export type PlacementAlign = 'start' | 'center' | 'end';

/** What {@link placePopover} places. */
export interface PlacementRequest {
  /** The rectangle the popover belongs to: a selection's screen box, a button. */
  readonly anchor: ScreenRect;
  /** The popover's size. */
  readonly size: { readonly width: number; readonly height: number };
  /** The visible area it must stay inside. */
  readonly viewport: ScreenRect;
  /** The side it prefers; the opposite side is tried next, then the other two. */
  readonly side: PlacementSide;
  /** How it lines up along the anchor; `center` if absent. */
  readonly align?: PlacementAlign;
  /** Space between the anchor and the popover, px; 8 if absent. */
  readonly gap?: number;
  /** Space it keeps from the viewport's edges, px; 8 if absent. */
  readonly margin?: number;
  /** Areas it must not cover (the dock, the zoom control, the facilitate card). */
  readonly reserved?: readonly ScreenRect[];
  /** The page's direction, which `start` and `end` follow; `ltr` if absent. */
  readonly direction?: 'ltr' | 'rtl';
}

/** Where {@link placePopover} put the popover. */
export interface Placement {
  /** Its left edge. */
  readonly x: number;
  /** Its top edge. */
  readonly y: number;
  /** The side of the anchor it ended up on. */
  readonly side: PlacementSide;
  /**
   * Whether it found room: off the anchor, inside the viewport's margin and clear of every
   * reserved area. When nothing fits, it is the least bad spot, held inside the viewport.
   */
  readonly isClear: boolean;
}

/** The default space between anchor and popover, px. */
export const DEFAULT_PLACEMENT_GAP_PX = 8;

/** The default space kept from the viewport's edges, px. */
export const DEFAULT_VIEWPORT_MARGIN_PX = 8;

const OPPOSITE: Readonly<Record<PlacementSide, PlacementSide>> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

/**
 * The sides to try, in order: the preferred one, its opposite, then the other two (the
 * preferred axis's neighbours in reading order, so the result is the same for equal inputs).
 *
 * @param side - The preferred side.
 * @returns Every side, once.
 */
function sidesToTry(side: PlacementSide): readonly PlacementSide[] {
  const isVertical = side === 'top' || side === 'bottom';
  const across: readonly PlacementSide[] = isVertical ? ['right', 'left'] : ['bottom', 'top'];
  return [side, OPPOSITE[side], ...across];
}

/**
 * The area two rectangles share, 0 when they only touch.
 *
 * @param a - One rectangle.
 * @param b - The other.
 * @returns The area of their overlap, px².
 */
function overlapArea(a: ScreenRect, b: ScreenRect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Holds a value inside a range; when the range is empty (the popover is wider than the room),
 * its low end wins, so the popover's start edge stays on screen.
 *
 * @param value - The value.
 * @param low - The smallest value allowed.
 * @param high - The largest value allowed.
 * @returns The value, held inside.
 */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

/** One side's line: where the popover sits across it and the range it may slide along it. */
interface SideLine {
  /** The fixed coordinate across the side: y for top and bottom, x for left and right. */
  readonly main: number;
  /** Whether the popover fits between the anchor and the viewport's margin on this side. */
  readonly hasRoom: boolean;
  /** The aligned position along the side, before it is held inside the viewport. */
  readonly aligned: number;
  /** The smallest position along the side that stays inside the viewport's margin. */
  readonly low: number;
  /** The largest. */
  readonly high: number;
}

/**
 * Where a popover would sit on one side of its anchor.
 *
 * @param request - The request.
 * @param side - The side.
 * @returns Its line.
 */
function sideLine(request: PlacementRequest, side: PlacementSide): SideLine {
  const { anchor, size, viewport } = request;
  const gap = request.gap ?? DEFAULT_PLACEMENT_GAP_PX;
  const margin = request.margin ?? DEFAULT_VIEWPORT_MARGIN_PX;
  const isVertical = side === 'top' || side === 'bottom';
  const length = isVertical ? size.width : size.height;
  const depth = isVertical ? size.height : size.width;
  const anchorStart = isVertical ? anchor.x : anchor.y;
  const anchorLength = isVertical ? anchor.width : anchor.height;
  const viewStart = isVertical ? viewport.x : viewport.y;
  const viewLength = isVertical ? viewport.width : viewport.height;
  const main =
    side === 'top'
      ? anchor.y - gap - depth
      : side === 'bottom'
        ? anchor.y + anchor.height + gap
        : side === 'left'
          ? anchor.x - gap - depth
          : anchor.x + anchor.width + gap;
  const mainLow = (isVertical ? viewport.y : viewport.x) + margin;
  const mainHigh =
    (isVertical ? viewport.y + viewport.height : viewport.x + viewport.width) - margin;
  const hasRoom = main >= mainLow && main + depth <= mainHigh;
  const isMirrored = isVertical && request.direction === 'rtl';
  const align = request.align ?? 'center';
  const atStart = isMirrored ? anchorStart + anchorLength - length : anchorStart;
  const atEnd = isMirrored ? anchorStart : anchorStart + anchorLength - length;
  const aligned =
    align === 'center'
      ? anchorStart + (anchorLength - length) / 2
      : align === 'start'
        ? atStart
        : atEnd;
  const low = viewStart + margin;
  const high = viewStart + viewLength - margin - length;
  return { main, hasRoom, aligned, low, high };
}

/**
 * The positions along a side worth trying, nearest the aligned one first: the aligned position
 * held inside the viewport, then each spot just clear of a reserved area, before or after it,
 * that still lies alongside part of the anchor.
 *
 * @param request - The request.
 * @param side - The side.
 * @param line - The side's line.
 * @returns Candidate positions along the side, held inside the viewport, nearest first.
 */
function candidatesAlong(
  request: PlacementRequest,
  side: PlacementSide,
  line: SideLine,
): readonly number[] {
  const isVertical = side === 'top' || side === 'bottom';
  const length = isVertical ? request.size.width : request.size.height;
  const anchorStart = isVertical ? request.anchor.x : request.anchor.y;
  const anchorEnd = anchorStart + (isVertical ? request.anchor.width : request.anchor.height);
  const held = [clamp(line.aligned, line.low, line.high)];
  for (const zone of request.reserved ?? []) {
    const zoneStart = isVertical ? zone.x : zone.y;
    const zoneLength = isVertical ? zone.width : zone.height;
    for (const spot of [zoneStart - length, zoneStart + zoneLength]) {
      const along = clamp(spot, line.low, line.high);
      // A slide that leaves the popover beside nothing of its anchor reads as another
      // object's popover: such a spot is not a candidate (the next side is tried instead).
      if (along < anchorEnd && along + length > anchorStart) held.push(along);
    }
  }
  return [...new Set(held)].sort(
    (a, b) => Math.abs(a - line.aligned) - Math.abs(b - line.aligned) || a - b,
  );
}

/**
 * The popover's rectangle at a position along a side.
 *
 * @param request - The request.
 * @param side - The side.
 * @param main - Its coordinate across the side.
 * @param along - Its coordinate along the side.
 * @returns Its rectangle.
 */
function rectAt(
  request: PlacementRequest,
  side: PlacementSide,
  main: number,
  along: number,
): ScreenRect {
  const isVertical = side === 'top' || side === 'bottom';
  return {
    x: isVertical ? along : main,
    y: isVertical ? main : along,
    width: request.size.width,
    height: request.size.height,
  };
}

/**
 * How much of the reserved areas a rectangle covers.
 *
 * @param request - The request.
 * @param rect - The rectangle.
 * @returns The area covered, px².
 */
function reservedOverlap(request: PlacementRequest, rect: ScreenRect): number {
  return (request.reserved ?? []).reduce((sum, zone) => sum + overlapArea(rect, zone), 0);
}

/**
 * Where a popover fits on one given side of its anchor, if it does: the first spot along that
 * side (the aligned one, else the nearest clear of the reserved areas while still beside the
 * anchor) with room inside the viewport's margin and no reserved area under it. The building
 * block of rules that weigh the sides themselves (the selection's popover). Pure.
 *
 * @param request - The anchor, the popover's size, the viewport and the preferences; its
 *   `side` is ignored.
 * @param side - The side to try.
 * @returns The clear placement on that side, or undefined when the side has none.
 */
export function placeOnSide(request: PlacementRequest, side: PlacementSide): Placement | undefined {
  const line = sideLine(request, side);
  if (!line.hasRoom) return undefined;
  for (const along of candidatesAlong(request, side, line)) {
    const rect = rectAt(request, side, line.main, along);
    if (reservedOverlap(request, rect) === 0) return { x: rect.x, y: rect.y, side, isClear: true };
  }
  return undefined;
}

/**
 * Places a popover beside its anchor: on the preferred side if it has room, else the
 * opposite side, else one of the other two; lined up as asked (start and end following the
 * page's direction), slid along the side to stay inside the viewport's margin and, if it can,
 * clear of the reserved areas (the dock, the zoom control, the facilitate card). It never
 * covers the anchor while a side has room. When no side has room it takes the spot that
 * covers the least reserved area, held inside the viewport, and says it did not fit. Pure.
 *
 * @param request - The anchor, the popover's size, the viewport and the preferences.
 * @returns Where the popover's top left goes, the side it is on and whether it fitted.
 */
export function placePopover(request: PlacementRequest): Placement {
  let fallback: { readonly placement: Placement; readonly cost: number } | undefined;
  for (const side of sidesToTry(request.side)) {
    const line = sideLine(request, side);
    for (const along of candidatesAlong(request, side, line)) {
      const rect = rectAt(request, side, line.main, along);
      const covered = reservedOverlap(request, rect);
      if (line.hasRoom && covered === 0) return { x: rect.x, y: rect.y, side, isClear: true };
      // A side without room costs more than any overlap, so a side with room always wins.
      const cost = covered + (line.hasRoom ? 0 : Number.MAX_SAFE_INTEGER / 2);
      if (fallback === undefined || cost < fallback.cost) {
        fallback = { placement: { x: rect.x, y: rect.y, side, isClear: false }, cost };
      }
    }
  }
  // Every side was tried, so a fallback exists; hold it inside the viewport.
  const best = fallback?.placement ?? { x: 0, y: 0, side: request.side, isClear: false };
  const margin = request.margin ?? DEFAULT_VIEWPORT_MARGIN_PX;
  const { viewport, size } = request;
  return {
    ...best,
    x: clamp(best.x, viewport.x + margin, viewport.x + viewport.width - margin - size.width),
    y: clamp(best.y, viewport.y + margin, viewport.y + viewport.height - margin - size.height),
  };
}
