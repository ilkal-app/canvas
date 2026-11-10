import { MAX_GRADIENT_STOPS, type Gradient, type Rgba } from '@canvas/schema';

// One gradient's record in the scene's paint table: what the
// gradient variants' fragment shaders read with textureLoad / texelFetch to evaluate the paint
// exactly as `paintColorAt` does. Fixed size, so a record is allocated with its object and
// rewritten in place when its paint changes.

/** Texels per gradient record: a header, eight premultiplied stop colours, two of offsets. */
export const GRADIENT_RECORD_TEXELS = 11;

/** Floats per gradient record: {@link GRADIENT_RECORD_TEXELS} rgba32float texels, 176 bytes. */
export const GRADIENT_RECORD_FLOATS = GRADIENT_RECORD_TEXELS * 4;

/** The header's type code of a linear gradient. */
export const LINEAR_GRADIENT_CODE = 0;

/** The header's type code of a radial gradient. */
export const RADIAL_GRADIENT_CODE = 1;

/**
 * Packs a gradient into its paint-table record, the layout the gradient shaders read:
 *
 * | Texel | Content                                                                         |
 * | ----- | ------------------------------------------------------------------------------- |
 * | 0     | linear: (0, cos a / (|cos a| + |sin a|), sin a / (|cos a| + |sin a|), 0); radial: (1, centre x, centre y, 1 / radius) |
 * | 1–8   | the stops' colours, premultiplied (r·a, g·a, b·a, a), in order                  |
 * | 9–10  | the stops' offsets, four per texel                                              |
 *
 * With the header a linear gradient's position is `0.5 + (u − 0.5)·h.y + (v − 0.5)·h.z` and a
 * radial one's `length((u, v) − h.yz) · h.w`, `paintColorAt`'s formulas with the division done
 * once here. Stops past the gradient's last repeat it (its offset and colour), so the shader
 * always walks eight: a repeated stop is never past a position its original was not, so the
 * result is the last stop's colour exactly as `paintColorAt` pads. Allocates nothing. Pure apart
 * from writing `target`.
 *
 * @param gradient - The gradient, as the schema accepts it (2 to 8 stops).
 * @param target - The destination.
 * @param offset - The float index the record starts at. Default 0.
 */
export function packGradientRecord(gradient: Gradient, target: Float32Array, offset = 0): void {
  if (gradient.type === 'linear') {
    const dx = Math.cos(gradient.angle);
    const dy = Math.sin(gradient.angle);
    const span = Math.abs(dx) + Math.abs(dy);
    target[offset] = LINEAR_GRADIENT_CODE;
    target[offset + 1] = dx / span;
    target[offset + 2] = dy / span;
    target[offset + 3] = 0;
  } else {
    target[offset] = RADIAL_GRADIENT_CODE;
    target[offset + 1] = gradient.center.x;
    target[offset + 2] = gradient.center.y;
    target[offset + 3] = 1 / gradient.radius;
  }
  const { stops } = gradient;
  const offsets = offset + (1 + MAX_GRADIENT_STOPS) * 4;
  for (let index = 0; index < MAX_GRADIENT_STOPS; index += 1) {
    const stop = stops[Math.min(index, stops.length - 1)];
    const color: Rgba = stop?.color ?? [0, 0, 0, 0];
    const at = offset + (1 + index) * 4;
    const alpha = color[3];
    target[at] = color[0] * alpha;
    target[at + 1] = color[1] * alpha;
    target[at + 2] = color[2] * alpha;
    target[at + 3] = alpha;
    target[offsets + index] = stop?.offset ?? 1;
  }
}
