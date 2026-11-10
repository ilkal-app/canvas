import { clampZoom, type Camera, type WorldBounds } from '@canvas/engine';

/** A point on screen in CSS pixels from the viewport's top-left corner, y down. */
export interface ScreenPoint {
  /** CSS px from the viewport's left edge. */
  readonly x: number;
  /** CSS px from the viewport's top edge. */
  readonly y: number;
}

/** The size of the viewport a camera shows, as the canvas reports it. */
export interface ViewportSize {
  /** Width, CSS px. */
  readonly cssWidthPx: number;
  /** Height, CSS px. */
  readonly cssHeightPx: number;
  /** Device pixels per CSS pixel. */
  readonly dpr: number;
}

/**
 * Moves the board on screen by a drag: after the pan, every world point shows `deltaXPx` further
 * right and `deltaYPx` further down (the prototype's `panBy`, webgl-whiteboard
 * `src/render/camera.ts`, in this camera's world-top-left form).
 *
 * @param camera - The camera; not changed.
 * @param deltaXPx - How far the board moves right, CSS px.
 * @param deltaYPx - How far the board moves down, CSS px.
 * @returns The panned camera.
 */
export function panCamera(camera: Camera, deltaXPx: number, deltaYPx: number): Camera {
  return {
    ...camera,
    x: camera.x - deltaXPx / camera.zoom,
    y: camera.y - deltaYPx / camera.zoom,
  };
}

/**
 * Zooms by a factor about a screen point, keeping the world point under it fixed on screen (the
 * prototype's `zoomAt`, webgl-whiteboard `src/render/camera.ts`). The zoom is clamped to the
 * navigable range (`clampZoom`); the point stays fixed at the clamped zoom too.
 *
 * @param camera - The camera; not changed.
 * @param point - The fixed point, CSS px on the viewport (the cursor, a pinch's midpoint).
 * @param factor - The zoom multiplier; above 1 zooms in.
 * @returns The zoomed camera, or `camera` itself when the clamped zoom does not change.
 * @throws {RangeError} When `factor` is not a positive finite number.
 */
export function zoomCameraAt(camera: Camera, point: ScreenPoint, factor: number): Camera {
  if (!(factor > 0) || !Number.isFinite(factor)) {
    throw new RangeError(`A zoom factor must be positive and finite, not ${String(factor)}.`);
  }
  return zoomAbout(camera, point, clampZoom(camera.zoom * factor));
}

/**
 * Sets the zoom to a level, clamped, about the viewport's centre.
 *
 * @param camera - The camera; not changed.
 * @param zoom - The requested zoom, CSS px per world unit.
 * @returns The zoomed camera, or `camera` itself when the clamped zoom does not change.
 * @throws {RangeError} When `zoom` is NaN.
 */
export function zoomCameraTo(camera: Camera, zoom: number): Camera {
  const centre = { x: camera.viewportWidthPx / 2, y: camera.viewportHeightPx / 2 };
  return zoomAbout(camera, centre, clampZoom(zoom));
}

/**
 * Frames a world rectangle: the largest zoom (clamped) at which it fits inside the viewport less
 * `paddingPx` on every side, centred on both axes. A rectangle with no area on either axis (a
 * point) is centred at the current zoom.
 *
 * @param camera - The camera; not changed.
 * @param bounds - The rectangle to show, world units.
 * @param paddingPx - The margin to keep clear on each side, CSS px; at least one pixel of
 *   viewport is always left to fit into.
 * @returns The camera showing the rectangle.
 * @throws {RangeError} When the bounds are inverted or not finite, or the padding is negative.
 */
export function fitCameraToRect(camera: Camera, bounds: WorldBounds, paddingPx: number): Camera {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!(width >= 0) || !(height >= 0) || !Number.isFinite(width + height)) {
    throw new RangeError('Fit bounds must be finite with max ≥ min on both axes.');
  }
  if (!(paddingPx >= 0)) {
    throw new RangeError(`A fit padding must be zero or more, not ${String(paddingPx)}.`);
  }
  const availableWidthPx = Math.max(1, camera.viewportWidthPx - 2 * paddingPx);
  const availableHeightPx = Math.max(1, camera.viewportHeightPx - 2 * paddingPx);
  const zoom =
    width === 0 && height === 0
      ? camera.zoom
      : clampZoom(Math.min(availableWidthPx / width, availableHeightPx / height));
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;
  return {
    ...camera,
    zoom,
    x: centreX - camera.viewportWidthPx / (2 * zoom),
    y: centreY - camera.viewportHeightPx / (2 * zoom),
  };
}

/**
 * Returns to where a board opens: the world origin at the viewport's top-left corner, 100%.
 *
 * @param camera - The camera; not changed. Its viewport is kept.
 * @returns The reset camera.
 */
export function resetCameraToOrigin(camera: Camera): Camera {
  return { ...camera, x: 0, y: 0, zoom: 1 };
}

/**
 * Follows a viewport resize: the world point at the top-left corner and the zoom stay, so the
 * board does not jump when the window or a panel changes size.
 *
 * @param camera - The camera; not changed.
 * @param size - The viewport's new CSS size and device pixel ratio.
 * @returns The resized camera, or `camera` itself when nothing changed.
 */
export function resizeCameraViewport(camera: Camera, size: ViewportSize): Camera {
  if (
    camera.viewportWidthPx === size.cssWidthPx &&
    camera.viewportHeightPx === size.cssHeightPx &&
    camera.dpr === size.dpr
  ) {
    return camera;
  }
  return {
    ...camera,
    viewportWidthPx: size.cssWidthPx,
    viewportHeightPx: size.cssHeightPx,
    dpr: size.dpr,
  };
}

function zoomAbout(camera: Camera, point: ScreenPoint, zoom: number): Camera {
  if (zoom === camera.zoom) return camera;
  const worldX = point.x / camera.zoom + camera.x;
  const worldY = point.y / camera.zoom + camera.y;
  return { ...camera, zoom, x: worldX - point.x / zoom, y: worldY - point.y / zoom };
}
