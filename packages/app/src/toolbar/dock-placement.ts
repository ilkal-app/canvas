import { useLayoutEffect, useState, type RefObject } from 'react';

/** The attribute that marks the zoom control, which the dock keeps clear of. */
export const ZOOM_CONTROL_ATTRIBUTE = 'data-zoom-control';

/**
 * Where the dock sits along the canvas's bottom edge (item 12, the mode switcher widening
 * it): `centre`, its home; `beside`, just right of the zoom control when centred it would cover
 * it; `above`, centred a row higher, over the zoom control, when it does not fit beside it either
 * (a narrow window).
 */
export type DockPlacement =
  | { readonly kind: 'centre' }
  | { readonly kind: 'beside'; readonly leftPx: number }
  | { readonly kind: 'above' };

/** What {@link dockPlacementOf} decides from, CSS px, measured in the canvas's box. */
export interface DockFit {
  /** The canvas's width. */
  readonly canvasWidthPx: number;
  /** The dock's width. */
  readonly dockWidthPx: number;
  /** The zoom control's right edge, from the canvas's left edge. */
  readonly zoomRightPx: number;
  /** The margin kept from the canvas's right edge (`dockInset`). */
  readonly insetPx: number;
  /** The gap kept between the zoom control and the dock (`--space-2`). */
  readonly gapPx: number;
}

/**
 * Where the dock goes: centred while that leaves the gap to the zoom control's right edge, else
 * just right of the zoom control while it fits before the canvas's right margin, else a row
 * above. Pure.
 *
 * @param fit - The canvas's, the dock's and the zoom control's measures.
 * @returns The placement.
 */
export function dockPlacementOf(fit: DockFit): DockPlacement {
  const { canvasWidthPx, dockWidthPx, zoomRightPx, insetPx, gapPx } = fit;
  const clearLeftPx = zoomRightPx + gapPx;
  if ((canvasWidthPx - dockWidthPx) / 2 >= clearLeftPx) return { kind: 'centre' };
  if (clearLeftPx + dockWidthPx <= canvasWidthPx - insetPx) {
    return { kind: 'beside', leftPx: clearLeftPx };
  }
  return { kind: 'above' };
}

/** The margins {@link useDockPlacement} keeps, CSS px: `dockInset` and `--space-2`. */
const INSET_PX = 16;
const GAP_PX = 8;

/**
 * Whether two placements are the same.
 *
 * @param first - One placement.
 * @param second - The other.
 * @returns True when they place the dock alike.
 */
function isSamePlacement(first: DockPlacement, second: DockPlacement): boolean {
  if (first.kind !== second.kind) return false;
  return first.kind !== 'beside' || second.kind !== 'beside' || first.leftPx === second.leftPx;
}

/**
 * The dock's placement ({@link dockPlacementOf}), measured from the dock, its canvas (the dock's
 * offset parent) and the zoom control in it (marked {@link ZOOM_CONTROL_ATTRIBUTE}), and measured
 * again whenever the dock or the canvas changes size. Centred until measured, and where
 * `ResizeObserver` is missing. Main thread.
 *
 * @param dockRef - The dock.
 * @returns The placement.
 */
export function useDockPlacement(dockRef: RefObject<HTMLElement | null>): DockPlacement {
  const [placement, setPlacement] = useState<DockPlacement>({ kind: 'centre' });
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const canvas = dock?.offsetParent;
    if (dock === null || !(canvas instanceof HTMLElement) || typeof ResizeObserver === 'undefined')
      return undefined;
    const place = (): void => {
      const zoom = canvas.querySelector<HTMLElement>(`[${ZOOM_CONTROL_ATTRIBUTE}]`);
      const next = dockPlacementOf({
        canvasWidthPx: canvas.clientWidth,
        dockWidthPx: dock.offsetWidth,
        zoomRightPx: zoom === null ? 0 : zoom.offsetLeft + zoom.offsetWidth,
        insetPx: INSET_PX,
        gapPx: GAP_PX,
      });
      setPlacement((shown) => (isSamePlacement(shown, next) ? shown : next));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(dock);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }, [dockRef]);
  return placement;
}
