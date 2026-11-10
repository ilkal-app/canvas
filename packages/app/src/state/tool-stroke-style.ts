import type { StylePatch } from '@canvas/document';
import type { StrokeStyle } from '@canvas/schema';

/**
 * The stroke style a creation tool's style sets: its dash, join, miter limit and cap,
 * each only when chosen; a dash chosen Solid (null) and fields never chosen leave no key, so the
 * tool draws as it did before stroke styles. Pure.
 *
 * @param style - The tool's style (`ToolStyles`), if any.
 * @returns The set fields.
 */
export function toolStrokeStyleOf(style: StylePatch | undefined): StrokeStyle {
  if (style === undefined) return {};
  const { strokeDash, strokeJoin, strokeMiterLimit, strokeCap } = style;
  return {
    ...(strokeDash !== undefined && strokeDash !== null && { strokeDash }),
    ...(strokeJoin !== undefined && { strokeJoin }),
    ...(strokeMiterLimit !== undefined && { strokeMiterLimit }),
    ...(strokeCap !== undefined && { strokeCap }),
  };
}
