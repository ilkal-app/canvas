import type { StrokeStyle } from '@canvas/schema';

/**
 * The stroke style fields a tool's style sets, for a new path, line or connector: each
 * of `strokeDash`, `strokeJoin`, `strokeMiterLimit` and `strokeCap` that is set, and no key for
 * the rest (a solid, null dash included), so an object drawn with a tool's default style stores
 * exactly what it stored before stroke styles. Pure.
 *
 * @param style - The tool's style.
 * @returns The set fields.
 */
export function strokeStyleOf(style: StrokeStyle): StrokeStyle {
  const { strokeDash, strokeJoin, strokeMiterLimit, strokeCap } = style;
  return {
    ...(strokeDash !== undefined && strokeDash !== null && { strokeDash }),
    ...(strokeJoin !== undefined && { strokeJoin }),
    ...(strokeMiterLimit !== undefined && { strokeMiterLimit }),
    ...(strokeCap !== undefined && { strokeCap }),
  };
}
