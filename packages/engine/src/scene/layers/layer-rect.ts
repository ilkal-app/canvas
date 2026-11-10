import type { Camera, WorldBounds } from '../../camera/camera.js';
import type { GpuViewport } from '../../gpu/gpu-render-pass.js';

/**
 * Device pixels a layer's rectangle reaches past its content on every side, so
 * antialiased edges that round into the next pixel are inside the target.
 */
export const LAYER_RECT_MARGIN_PX = 1;

/** Device pixels within which an edge counts as on a pixel boundary (floating-point noise). */
const EDGE_SLACK = 1e-6;

/**
 * The canvas in device pixels: the camera's viewport times its pixel ratio, rounded (the drawing
 * buffer the camera maps clip space onto). Pure.
 *
 * @param camera - The camera.
 * @returns The canvas rectangle, origin at 0.
 */
export function canvasDeviceRect(camera: Camera): GpuViewport {
  return {
    x: 0,
    y: 0,
    width: Math.round(camera.viewportWidthPx * camera.dpr),
    height: Math.round(camera.viewportHeightPx * camera.dpr),
  };
}

/**
 * Where a layer's target lands on the canvas: its content's world bounds under the
 * camera, rounded outward to whole device pixels plus {@link LAYER_RECT_MARGIN_PX}, then cut to
 * `within` (the canvas, or the parent layer's rectangle: a nested layer draws into its parent's
 * target, which holds nothing outside). The bounds already exclude what ancestor clips cut away
 * (the spatial index clips each box), so the rectangle is the visible part only. Pure.
 *
 * @param bounds - The layer's content, world units.
 * @param camera - The frame's camera.
 * @param within - The rectangle it must stay inside, device pixels.
 * @returns The rectangle in canvas device pixels, or undefined when nothing of it is inside.
 */
export function layerDeviceRect(
  bounds: WorldBounds,
  camera: Camera,
  within: GpuViewport,
): GpuViewport | undefined {
  const scale = camera.zoom * camera.dpr;
  // Rounding noise (a clipped box's 19.999999999999996) must not cost a whole pixel.
  const left = Math.floor((bounds.minX - camera.x) * scale + EDGE_SLACK) - LAYER_RECT_MARGIN_PX;
  const top = Math.floor((bounds.minY - camera.y) * scale + EDGE_SLACK) - LAYER_RECT_MARGIN_PX;
  const right = Math.ceil((bounds.maxX - camera.x) * scale - EDGE_SLACK) + LAYER_RECT_MARGIN_PX;
  const bottom = Math.ceil((bounds.maxY - camera.y) * scale - EDGE_SLACK) + LAYER_RECT_MARGIN_PX;
  const x = Math.max(left, within.x);
  const y = Math.max(top, within.y);
  const width = Math.min(right, within.x + within.width) - x;
  const height = Math.min(bottom, within.y + within.height) - y;
  if (!(width > 0 && height > 0)) return undefined;
  return { x, y, width, height };
}

/**
 * The camera a layer's target draws with: the frame's camera moved by the
 * rectangle's whole-pixel origin, its viewport the target's size, so the target's pixel (i, j) is
 * the canvas's pixel (x + i, y + j) and every pass's world-to-clip map is unchanged in shape. The
 * target may be larger than the rectangle (a pooled one); the rest of it is left unread. Pure.
 *
 * @param camera - The frame's camera.
 * @param rect - The layer's rectangle in canvas device pixels.
 * @param target - The target's size in device pixels.
 * @param target.width - Its width.
 * @param target.height - Its height.
 * @returns The translated camera.
 */
export function layerCamera(
  camera: Camera,
  rect: GpuViewport,
  target: { readonly width: number; readonly height: number },
): Camera {
  const scale = camera.zoom * camera.dpr;
  return {
    x: camera.x + rect.x / scale,
    y: camera.y + rect.y / scale,
    zoom: camera.zoom,
    dpr: camera.dpr,
    viewportWidthPx: target.width / camera.dpr,
    viewportHeightPx: target.height / camera.dpr,
  };
}
