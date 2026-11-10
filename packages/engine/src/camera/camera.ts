import type { Point } from '@canvas/schema';

/**
 * The view onto the board: which world point sits at the viewport's top-left corner, the zoom,
 * and the viewport's size. A plain value: a pan or zoom makes a new camera, and a frame whose
 * camera alone changed uploads only the camera uniform.
 *
 * Screen points are CSS pixels from the viewport's top-left corner, y down; device pixels are
 * CSS pixels × `dpr`.
 */
export interface Camera {
  /** World x at the viewport's left edge, world units. */
  readonly x: number;
  /** World y at the viewport's top edge, world units. */
  readonly y: number;
  /** CSS pixels per world unit; see `clampZoom` for the supported range. */
  readonly zoom: number;
  /** The viewport width, CSS pixels. */
  readonly viewportWidthPx: number;
  /** The viewport height, CSS pixels. */
  readonly viewportHeightPx: number;
  /** Device pixels per CSS pixel; tests fix it (Global Constraint 3). */
  readonly dpr: number;
}

/** An axis-aligned rectangle in world units, edges inclusive. */
export interface WorldBounds {
  /** The left edge, world units. */
  readonly minX: number;
  /** The top edge, world units. */
  readonly minY: number;
  /** The right edge, world units. */
  readonly maxX: number;
  /** The bottom edge, world units. */
  readonly maxY: number;
}

/**
 * The affine map from world units to clip space as `[scaleX, scaleY, offsetX, offsetY]`:
 * `clip = world × scale + offset`, with clip y pointing up. It is the camera uniform every scene
 * pass reads.
 */
export type CameraClipTransform = readonly [
  scaleX: number,
  scaleY: number,
  offsetX: number,
  offsetY: number,
];

/**
 * Maps a world point to the screen.
 *
 * @param camera - The camera.
 * @param point - A point in world units.
 * @returns The point in CSS pixels from the viewport's top-left corner.
 */
export function worldToScreen(camera: Camera, point: Point): Point {
  return { x: (point.x - camera.x) * camera.zoom, y: (point.y - camera.y) * camera.zoom };
}

/**
 * Maps a screen point to the world: the inverse of {@link worldToScreen}. Tools use it to turn
 * pointer positions into board coordinates.
 *
 * @param camera - The camera.
 * @param point - A point in CSS pixels from the viewport's top-left corner.
 * @returns The point in world units.
 */
export function screenToWorld(camera: Camera, point: Point): Point {
  return { x: point.x / camera.zoom + camera.x, y: point.y / camera.zoom + camera.y };
}

/**
 * The part of the world the viewport shows.
 *
 * @param camera - The camera.
 * @returns The visible rectangle, world units.
 */
export function visibleWorldBounds(camera: Camera): WorldBounds {
  return {
    minX: camera.x,
    minY: camera.y,
    maxX: camera.x + camera.viewportWidthPx / camera.zoom,
    maxY: camera.y + camera.viewportHeightPx / camera.zoom,
  };
}

/**
 * The world-to-clip map a scene pass's vertex shader applies. The viewport's top-left corner
 * maps to clip (−1, 1) and its bottom-right corner to (1, −1).
 *
 * @param camera - The camera.
 * @returns `[scaleX, scaleY, offsetX, offsetY]` with `clip = world × scale + offset`.
 */
export function cameraClipTransform(camera: Camera): CameraClipTransform {
  const scaleX = (2 * camera.zoom) / camera.viewportWidthPx;
  const scaleY = (-2 * camera.zoom) / camera.viewportHeightPx;
  return [scaleX, scaleY, -1 - camera.x * scaleX, 1 - camera.y * scaleY];
}

/**
 * Whether two cameras show the same view at the same size and pixel ratio.
 *
 * @param first - One camera.
 * @param second - Another camera.
 * @returns True when every field is equal.
 */
export function isSameCamera(first: Camera, second: Camera): boolean {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.zoom === second.zoom &&
    first.viewportWidthPx === second.viewportWidthPx &&
    first.viewportHeightPx === second.viewportHeightPx &&
    first.dpr === second.dpr
  );
}
