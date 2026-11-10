/** A width and height in pixels. */
export interface PixelSize {
  /** Width, px. */
  readonly widthPx: number;
  /** Height, px. */
  readonly heightPx: number;
}

/**
 * The size of the canvas on screen and of its drawing buffer. The engine renders into
 * `widthPx × heightPx` device pixels and maps CSS pixels to them with `dpr`.
 */
export interface CanvasBackingSize {
  /** Width on screen, CSS px. */
  readonly cssWidthPx: number;
  /** Height on screen, CSS px. */
  readonly cssHeightPx: number;
  /** Drawing buffer width, device px (the canvas `width` attribute); at least 1. */
  readonly widthPx: number;
  /** Drawing buffer height, device px (the canvas `height` attribute); at least 1. */
  readonly heightPx: number;
  /** Device pixels per CSS pixel. */
  readonly dpr: number;
}

/**
 * The most a true device-pixel size can differ from CSS size × ratio, rounded: the box's edges
 * snap to device pixels independently, so the width can gain or lose one pixel.
 */
const DEVICE_PIXEL_SNAP_TOLERANCE_PX = 1;

/**
 * Computes the canvas drawing buffer size for a CSS size and device pixel ratio, so the canvas
 * is sharp on high-density screens. An exact device-pixel size, which `ResizeObserver` reports
 * as `devicePixelContentBoxSize` where supported, wins over the rounded product, since only it
 * matches the pixels the compositor will show; but only when it is within a pixel of that
 * product, because headless Chrome with an emulated device scale factor reports CSS pixels there.
 *
 * @param cssSize - The canvas's content-box size, CSS px.
 * @param dpr - `window.devicePixelRatio`; a non-positive or non-finite value counts as 1.
 * @param devicePixelSize - The exact content-box size in device px, when known.
 * @returns The CSS size, the drawing buffer size (each at least 1 px) and the ratio used.
 */
export function computeBackingStoreSize(
  cssSize: PixelSize,
  dpr: number,
  devicePixelSize?: PixelSize,
): CanvasBackingSize {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const scaledWidthPx = Math.round(cssSize.widthPx * ratio);
  const scaledHeightPx = Math.round(cssSize.heightPx * ratio);
  const isDeviceSizePlausible =
    devicePixelSize !== undefined &&
    Math.abs(devicePixelSize.widthPx - scaledWidthPx) <= DEVICE_PIXEL_SNAP_TOLERANCE_PX &&
    Math.abs(devicePixelSize.heightPx - scaledHeightPx) <= DEVICE_PIXEL_SNAP_TOLERANCE_PX;
  const widthPx = isDeviceSizePlausible ? devicePixelSize.widthPx : scaledWidthPx;
  const heightPx = isDeviceSizePlausible ? devicePixelSize.heightPx : scaledHeightPx;
  return {
    cssWidthPx: cssSize.widthPx,
    cssHeightPx: cssSize.heightPx,
    widthPx: Math.max(1, widthPx),
    heightPx: Math.max(1, heightPx),
    dpr: ratio,
  };
}
