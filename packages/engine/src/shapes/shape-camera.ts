import { CAMERA_UNIFORM_BYTE_LENGTH } from '../scene/camera-uniform.js';

/**
 * The camera the shape shader draws through, in device pixels: a world point `(x, y)` lands on
 * pixel `(x × zoom + offsetXPx, y × zoom + offsetYPx)` of a `viewportWidthPx × viewportHeightPx`
 * viewport (the prototype's `Camera` plus its viewport uniform, `src/render/camera.ts`). `zoom`
 * includes the device pixel ratio. For a `ShapeRenderer` drawn outside a scene; a scene pass binds
 * the engine's `CameraUniform`, of the same layout.
 */
export interface ShapeCamera {
  /** The viewport's width, in device pixels; positive. */
  readonly viewportWidthPx: number;
  /** The viewport's height, in device pixels; positive. */
  readonly viewportHeightPx: number;
  /** Where world x = 0 lands, in device pixels from the viewport's left edge. */
  readonly offsetXPx: number;
  /** Where world y = 0 lands, in device pixels from the viewport's top edge. */
  readonly offsetYPx: number;
  /** Device pixels per world unit; positive. */
  readonly zoom: number;
}

/**
 * Bytes of the shape shader's `Camera` uniform block: the engine's camera uniform
 * (`CAMERA_UNIFORM_BYTE_LENGTH`, 32 bytes), which the shader adopts. The uniform
 * buffer bound at binding 0 must be this large.
 */
export const SHAPE_CAMERA_BYTE_LENGTH = CAMERA_UNIFORM_BYTE_LENGTH;

/**
 * Packs a camera into the engine's camera uniform layout (`cameraUniformValues`), ready for
 * `writeBuffer` before the pass begins: the world-to-clip map, then one device pixel in world
 * units.
 *
 * @param camera - The camera, in device pixels.
 * @returns `[scaleX, scaleY, offsetX, offsetY, 1 / zoom, 0, 0, 0]`, `clip = world × scale + offset`.
 * @throws {RangeError} When the zoom or a viewport dimension is not a positive number.
 */
export function packShapeCamera(camera: ShapeCamera): Float32Array<ArrayBuffer> {
  const { viewportWidthPx, viewportHeightPx, offsetXPx, offsetYPx, zoom } = camera;
  if (!(zoom > 0 && viewportWidthPx > 0 && viewportHeightPx > 0)) {
    throw new RangeError(
      `A shape camera needs a positive zoom and viewport size; received zoom ${String(zoom)}, viewport ${String(viewportWidthPx)} × ${String(viewportHeightPx)}.`,
    );
  }
  const scaleX = (2 * zoom) / viewportWidthPx;
  const scaleY = (-2 * zoom) / viewportHeightPx;
  const offsetX = (2 * offsetXPx) / viewportWidthPx - 1;
  const offsetY = 1 - (2 * offsetYPx) / viewportHeightPx;
  return new Float32Array([scaleX, scaleY, offsetX, offsetY, 1 / zoom, 0, 0, 0]);
}
