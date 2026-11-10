import type { ScreenRect } from '../controls/placement.js';

/**
 * The attribute a piece of floating chrome carries to keep the selection's popover off it:
 * the floating dock and its panels, the zoom control, the facilitate card, the board
 * bar, the presence bar. Lanes building that chrome add it to its root element.
 */
export const POPOVER_AVOID_ATTRIBUTE = 'data-popover-avoid';

/**
 * What the popover avoids today: anything marked with {@link POPOVER_AVOID_ATTRIBUTE}, and the
 * chrome already on the canvas that does not carry it yet: the zoom control, the dock, the top
 * bars and the compact bottom chrome.
 */
export const RESERVED_ZONE_SELECTOR = [
  `[${POPOVER_AVOID_ATTRIBUTE}]`,
  '[data-zoom-control]',
  '[role="toolbar"][aria-label="Tools"]',
  '[data-top-bar]',
  '[data-bottom-chrome]',
].join(', ');

/**
 * The reserved areas on screen, in the canvas's own pixels (its top left at 0, 0), as the
 * selection's popover sees them: each visible element `RESERVED_ZONE_SELECTOR` finds in the
 * document, measured now. Main thread; reads layout.
 *
 * @param canvas - The canvas's box on the page.
 * @param root - Where to look; the document if absent.
 * @param except - An element whose own chrome is left out: a popup's button; none if absent.
 * @returns The areas, empty ones left out.
 */
export function measureReservedZones(
  canvas: DOMRect,
  root: ParentNode = document,
  except?: Element | null,
): ScreenRect[] {
  return [...root.querySelectorAll(RESERVED_ZONE_SELECTOR)].flatMap((element) => {
    // The chrome a popup opens from (a phone's bottom sheet) is where it starts, not in its way.
    if (except !== undefined && except !== null && element.contains(except)) return [];
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return [];
    return [{ x: box.x - canvas.x, y: box.y - canvas.y, width: box.width, height: box.height }];
  });
}

/**
 * The reserved areas in the window's pixels, for a popup opened from the selection's popover
 * (its arrange and More menus): measured when it opens, so a long menu
 * opens on the side clear of the dock rather than under it. Main thread; reads layout.
 *
 * @param button - The popup's button: the chrome it sits in (a phone's bottom sheet) is left out.
 * @returns The areas, empty ones left out.
 */
export function measureWindowReservedZones(button?: Element | null): ScreenRect[] {
  return measureReservedZones(new DOMRect(), document, button);
}
