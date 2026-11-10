import { strokeOutsideFraction } from '@canvas/schema';

import type { GpuVertexBufferLayout } from '../gpu/vertex-layout.js';

import type { ShapeInstance, ShapeKind } from './shape-instance.js';

/**
 * Floats per shape instance record. The record is 20 little-endian `float32`s (80 bytes):
 *
 * | Float | Byte | Field                          | Shader input            |
 * | ----- | ---- | ------------------------------ | ----------------------- |
 * | 0–3   | 0    | x, y (world top-left), width, height (world) | `@location(1) rect` |
 * | 4–7   | 16   | fill red, green, blue, alpha (straight) | `@location(2) color` |
 * | 8     | 32   | radius (world)                 | `@location(3) shape.x`  |
 * | 9     | 36   | softness (world)               | `@location(3) shape.y`  |
 * | 10    | 40   | kind code ({@link SHAPE_KIND_CODES}) | `@location(3) shape.z` |
 * | 11–12 | 44   | rotation about (x, y) as (cos, sin) | `@location(4) axis` |
 * | 13–16 | 52   | outline red, green, blue, alpha (straight) | `@location(5) strokeColor` |
 * | 17    | 68   | outline width (world)          | `@location(6) outline.x` |
 * | 18    | 72   | sides of a polygon, points of a star | `@location(6) outline.y` |
 * | 19    | 76   | fraction of the outline outside the edge | `@location(6) outline.z` |
 *
 * Floats 13–18 were appended after the turn, and float 19 after them (0 an
 * outline inside the edge, as every outline before it, 0.5 centred on it, 1 outside it;
 * `strokeOutsideFraction`), so writers by index of the earlier floats keep their meaning. An
 * all-zero record (a released slot) has zero size, colour and axis, so it draws nothing; a zero
 * outline width draws no outline.
 */
export const SHAPE_INSTANCE_FLOATS = 20;

/** Bytes per shape instance record: {@link SHAPE_INSTANCE_FLOATS} `float32`s, 80 bytes. */
export const SHAPE_INSTANCE_BYTES = SHAPE_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;

/**
 * The number the shader receives for each {@link ShapeKind}. It is a float (the backend's vertex
 * formats are float or unorm) and the shader tests it against 0.5.
 */
export const SHAPE_KIND_CODES: Readonly<Record<ShapeKind, number>> = Object.freeze({
  'rounded-box': 0,
  ellipse: 1,
  diamond: 2,
  polygon: 3,
  star: 4,
});

/**
 * The kind code of a tiny shape's flat form (`writeFlatShapeRecord`): the shader draws
 * the record's box unpadded, at least a device pixel each way, in its colour, with no distance
 * arithmetic, and nothing when that colour is clear. Past every {@link SHAPE_KIND_CODES} value.
 */
export const SHAPE_FLAT_KIND_CODE = 5;

/**
 * The shader location of a rounded box's four corner radii, `float32x4`, top-left,
 * top-right, bottom-right, bottom-left: all 0 draws the record's one radius at every corner. Past
 * the variants' locations (7 to 11), the layer transparency's (12) and the clip index's
 * (14).
 */
export const SHAPE_CORNER_RADII_LOCATION = 15;

/**
 * The corner radii as an instance attribute (`SHAPE_CORNER_RADII_LOCATION`): the frame
 * passes' records carry it after the shape record (floats 20–23), before the clip index and the
 * layer transparency.
 */
export const SHAPE_CORNER_RADII_ATTRIBUTE = Object.freeze({
  location: SHAPE_CORNER_RADII_LOCATION,
  format: 'float32x4',
} as const);

/**
 * The shape passes' per-vertex buffer (slot 0): the unit quad's corner, `@location(0)`, and four
 * corner radii of 0 at `SHAPE_CORNER_RADII_LOCATION`, so a shape's record keeps
 * its 20 floats and draws its one radius (`SHAPE_QUAD_VERTICES`).
 */
export const SHAPE_QUAD_VERTEX_LAYOUT: GpuVertexBufferLayout = Object.freeze<GpuVertexBufferLayout>(
  {
    stepMode: 'vertex',
    attributes: [{ location: 0, format: 'float32x2' }, SHAPE_CORNER_RADII_ATTRIBUTE],
  },
);

/**
 * The frame passes' per-vertex buffer (slot 0): the unit quad's corner alone, `@location(0)`
 * (`SHAPE_QUAD_CORNERS`); their records carry the corner radii
 * (`SHAPE_CORNER_RADII_ATTRIBUTE`).
 */
export const SHAPE_QUAD_CORNER_VERTEX_LAYOUT: GpuVertexBufferLayout =
  Object.freeze<GpuVertexBufferLayout>({
    stepMode: 'vertex',
    attributes: [{ location: 0, format: 'float32x2' }],
  });

/**
 * The shape pipeline's per-instance buffer (slot 1): the record of {@link SHAPE_INSTANCE_FLOATS},
 * `@location(1)` to `@location(6)`; the shape pass's instance layout.
 */
export const SHAPE_INSTANCE_VERTEX_LAYOUT: GpuVertexBufferLayout =
  Object.freeze<GpuVertexBufferLayout>({
    stepMode: 'instance',
    attributes: [
      { location: 1, format: 'float32x4' },
      { location: 2, format: 'float32x4' },
      { location: 3, format: 'float32x3' },
      { location: 4, format: 'float32x2' },
      { location: 5, format: 'float32x4' },
      { location: 6, format: 'float32x3' },
    ],
  });

/**
 * The standalone shape pipeline's per-vertex buffer (slot 0 of `ShapeRenderer`): the unit quad's
 * corner at `@location(0)`, a clip index at `@location(14)`, always 0 (the shader
 * clips by its record's clip index, and a shape drawn outside a scene has nothing to clip it),
 * a layer transparency at `@location(12)`, always 0 (nothing fades a shape drawn
 * outside a scene), and four corner radii of 0 at `SHAPE_CORNER_RADII_LOCATION`.
 */
export const SHAPE_UNCLIPPED_QUAD_VERTEX_LAYOUT: GpuVertexBufferLayout =
  Object.freeze<GpuVertexBufferLayout>({
    stepMode: 'vertex',
    attributes: [
      { location: 0, format: 'float32x2' },
      { location: 14, format: 'float32' },
      { location: 12, format: 'float32' },
      SHAPE_CORNER_RADII_ATTRIBUTE,
    ],
  });

/**
 * The standalone shape pipeline's vertex buffers, in slot order: slot 0 is the unit quad's
 * corner, a clip index of 0, a transparency of 0 and zero corner radii per vertex
 * ({@link SHAPE_UNCLIPPED_QUAD_VERTEX_LAYOUT}); slot 1
 * is the per-instance record laid out as in {@link SHAPE_INSTANCE_FLOATS}. The scene's shape
 * pass reads the same record followed by its clip index and transparency, and the bare corner per
 * vertex.
 */
export const SHAPE_VERTEX_BUFFERS: readonly GpuVertexBufferLayout[] = Object.freeze([
  SHAPE_UNCLIPPED_QUAD_VERTEX_LAYOUT,
  SHAPE_INSTANCE_VERTEX_LAYOUT,
]);

/**
 * Packs shape instances into consecutive records of a caller-owned `Float32Array`, for upload
 * as a dirty range of a persistent instance buffer (so most frames upload
 * nothing). Pure apart from writing `target`; runs on any thread.
 *
 * @param instances - The shapes to pack, in draw order; not mutated.
 * @param target - The destination; only the records written are touched.
 * @param firstRecord - The record index the first instance is written at. Default 0.
 * @throws {RangeError} When `firstRecord` is not a non-negative integer, or `target` is too
 *   short to hold every record.
 */
export function packShapeInstances(
  instances: readonly ShapeInstance[],
  target: Float32Array,
  firstRecord = 0,
): void {
  if (!Number.isInteger(firstRecord) || firstRecord < 0) {
    throw new RangeError(
      `firstRecord must be a non-negative integer; received ${String(firstRecord)}.`,
    );
  }
  const end = (firstRecord + instances.length) * SHAPE_INSTANCE_FLOATS;
  if (instances.length > 0 && end > target.length) {
    throw new RangeError(
      `Packing ${String(instances.length)} shape records at record ${String(firstRecord)} needs ${String(end)} floats; the target has ${String(target.length)}.`,
    );
  }
  let offset = firstRecord * SHAPE_INSTANCE_FLOATS;
  for (const instance of instances) {
    const { color } = instance;
    target[offset] = instance.x;
    target[offset + 1] = instance.y;
    target[offset + 2] = instance.width;
    target[offset + 3] = instance.height;
    target[offset + 4] = color[0];
    target[offset + 5] = color[1];
    target[offset + 6] = color[2];
    target[offset + 7] = color[3];
    target[offset + 8] = instance.radius;
    target[offset + 9] = instance.softness;
    target[offset + 10] = SHAPE_KIND_CODES[instance.kind];
    const rotation = instance.rotation ?? 0;
    target[offset + 11] = rotation === 0 ? 1 : Math.cos(rotation);
    target[offset + 12] = rotation === 0 ? 0 : Math.sin(rotation);
    const { stroke } = instance;
    target[offset + 13] = stroke?.color[0] ?? 0;
    target[offset + 14] = stroke?.color[1] ?? 0;
    target[offset + 15] = stroke?.color[2] ?? 0;
    target[offset + 16] = stroke?.color[3] ?? 0;
    target[offset + 17] = stroke?.width ?? 0;
    target[offset + 18] = instance.sides ?? 0;
    target[offset + 19] = stroke === undefined ? 0 : strokeOutsideFraction(stroke.align);
    offset += SHAPE_INSTANCE_FLOATS;
  }
}
