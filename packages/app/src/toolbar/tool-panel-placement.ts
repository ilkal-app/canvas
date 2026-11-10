/** A rectangle in viewport CSS pixels: its top-left corner and size. */
export interface ViewportRect {
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  /** Width. */
  readonly width: number;
  /** Height. */
  readonly height: number;
}

/** A size in CSS pixels. */
export interface ViewportSize {
  /** Width. */
  readonly width: number;
  /** Height. */
  readonly height: number;
}

/** The gap between a tool panel's bottom edge and the dock's top edge (design), in px. */
export const TOOL_PANEL_GAP = 8;

/** The least distance kept between a tool panel and the viewport's sides, in px (the 16 px inset). */
export const TOOL_PANEL_INSET = 16;

/**
 * Where a tool panel goes: centred horizontally on the dock and {@link TOOL_PANEL_GAP}
 * above it, moved sideways only as far as it takes to keep {@link TOOL_PANEL_INSET} from the
 * viewport's sides (a panel wider than the room left starts at the inset). Whole pixels, so
 * its edges stay crisp. Pure.
 *
 * @param dock - The dock's box.
 * @param panel - The panel's size.
 * @param viewport - The viewport's size.
 * @returns The panel's box.
 */
export function toolPanelPlacement(
  dock: ViewportRect,
  panel: ViewportSize,
  viewport: ViewportSize,
): ViewportRect {
  const centred = dock.x + dock.width / 2 - panel.width / 2;
  const right = viewport.width - TOOL_PANEL_INSET - panel.width;
  const x = Math.max(TOOL_PANEL_INSET, Math.min(centred, right));
  return {
    x: Math.round(x),
    y: Math.round(dock.y - TOOL_PANEL_GAP - panel.height),
    width: panel.width,
    height: panel.height,
  };
}
