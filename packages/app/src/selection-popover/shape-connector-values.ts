import type { BoardObject, InkableColor, LineCap } from '@canvas/schema';

import { commonValue, isSameColour, MIXED, type Mixable } from '../panels/controls/mixed-value.js';

/** A shape the popover edits. */
export type PopoverShape = Extract<BoardObject, { readonly type: 'shape' }>;

/** A connector or a legacy line the popover edits. */
export type PopoverLine = Extract<BoardObject, { readonly type: 'connector' | 'line' }>;

/** The kinds the popover's Shape menu offers, as the shapes panel names them. */
export const POPOVER_SHAPE_KINDS = [
  'rectangle',
  'ellipse',
  'triangle',
  'diamond',
  'polygon',
  'star',
] as const;

/** One of {@link POPOVER_SHAPE_KINDS}. */
export type PopoverShapeKind = (typeof POPOVER_SHAPE_KINDS)[number];

/** The stroke widths the popover offers, px. */
export const POPOVER_STROKE_WIDTHS = [1, 2, 4, 8] as const;

/** A line's ends, as the popover names them. */
export type PopoverEnds = 'none' | 'end' | 'both';

/** A route a connector takes. */
export type PopoverRoute = 'straight' | 'elbow' | 'curved';

/**
 * Whether every selected object is a shape.
 *
 * @param selection - The selected objects.
 * @returns True for a selection of shapes only.
 */
export function isShapeSelection(
  selection: readonly BoardObject[],
): selection is readonly PopoverShape[] {
  return selection.length > 0 && selection.every((object) => object.type === 'shape');
}

/**
 * Whether every selected object is a connector or a legacy line.
 *
 * @param selection - The selected objects.
 * @returns True for a selection of connectors and lines only.
 */
export function isLineSelection(
  selection: readonly BoardObject[],
): selection is readonly PopoverLine[] {
  return (
    selection.length > 0 &&
    selection.every((object) => object.type === 'connector' || object.type === 'line')
  );
}

/**
 * The kind a shape shows as: a three-sided polygon is a triangle, as the shapes panel makes one.
 *
 * @param shape - The shape.
 * @returns Its kind.
 */
export function shapeKindOf(shape: PopoverShape): PopoverShapeKind {
  return shape.kind === 'polygon' && shape.sides === 3 ? 'triangle' : shape.kind;
}

/**
 * The shape fields a kind sets: a triangle is a three-sided polygon; a polygon keeps the sides a
 * polygon has (other than three), else takes five; a star takes five points unless it has some.
 * Only `kind` and `sides`: a shape keeps its size, label and connections.
 *
 * @param kind - The kind chosen.
 * @param shape - The shape it changes.
 * @returns The fields.
 */
export function kindStyleOf(
  kind: PopoverShapeKind,
  shape: PopoverShape,
): { readonly kind: PopoverShape['kind']; readonly sides?: number } {
  if (kind === 'triangle') return { kind: 'polygon', sides: 3 };
  if (kind === 'polygon') {
    const isPolygon = shape.kind === 'polygon' && shape.sides !== 3;
    return { kind: 'polygon', sides: isPolygon ? shape.sides : 5 };
  }
  return { kind };
}

/**
 * The fill the shapes share: a colour or none; a gradient or image fill reads as mixed, since a
 * colour button cannot show it.
 *
 * @param shapes - The shapes.
 * @returns The fill, or mixed.
 */
export function sharedFillOf(shapes: readonly PopoverShape[]): Mixable<InkableColor | null> {
  const fills = shapes.map((shape) => shape.fill);
  if (fills.some((fill) => fill !== null && !isPlainColour(fill))) return MIXED;
  return (
    commonValue(fills as readonly (InkableColor | null)[], (fill) => fill, isSameColour) ?? null
  );
}

/**
 * Whether a paint is a plain colour (a tuple, ink or a token), not a gradient or image.
 *
 * @param paint - The paint.
 * @returns True for a colour.
 */
export function isPlainColour(paint: unknown): paint is InkableColor {
  return (
    Array.isArray(paint) ||
    paint === 'ink' ||
    (typeof paint === 'object' && paint !== null && 'token' in paint)
  );
}

/**
 * The stroke colour the objects share (null: no stroke), or mixed.
 *
 * @param objects - The shapes or lines.
 * @returns The colour.
 */
export function sharedStrokeColourOf(
  objects: readonly (PopoverShape | PopoverLine)[],
): Mixable<InkableColor | null> {
  return commonValue(objects, (object) => object.stroke?.color ?? null, isSameColour) ?? null;
}

/**
 * The stroke width the objects share, or mixed: also mixed when some (or all) have no stroke,
 * whose width a choice leaves alone.
 *
 * @param objects - The shapes or lines.
 * @returns The width.
 */
export function sharedStrokeWidthOf(
  objects: readonly (PopoverShape | PopoverLine)[],
): Mixable<number> {
  return commonValue(objects, (object) => object.stroke?.width ?? null) ?? MIXED;
}

/**
 * The route the lines share, or mixed.
 *
 * @param lines - The connectors and lines.
 * @returns The route.
 */
export function sharedRouteOf(lines: readonly PopoverLine[]): Mixable<PopoverRoute> | undefined {
  return commonValue(lines, (line) => line.route);
}

/**
 * A line's ends, as the popover names them: none, at the end, or at both; undefined for a pair
 * of caps it cannot name (a cap at the start alone, or two different caps).
 *
 * @param line - The connector or line.
 * @returns Its ends.
 */
function endsOfLine(line: PopoverLine): PopoverEnds | undefined {
  const { startCap, endCap } = line;
  if (startCap === 'none') return endCap === 'none' ? 'none' : 'end';
  return startCap === endCap ? 'both' : undefined;
}

/**
 * The ends the lines share, or mixed (also when one line's caps have no name).
 *
 * @param lines - The connectors and lines.
 * @returns The ends.
 */
export function sharedEndsOf(lines: readonly PopoverLine[]): Mixable<PopoverEnds> {
  const ends = lines.map(endsOfLine);
  if (ends.some((end) => end === undefined)) return MIXED;
  return commonValue(ends as readonly PopoverEnds[], (end) => end) ?? MIXED;
}

/**
 * The cap the ends take: the selection's own cap where every capped end shares one, else an
 * arrow.
 *
 * @param lines - The connectors and lines.
 * @returns The cap.
 */
export function capOf(lines: readonly PopoverLine[]): Exclude<LineCap, 'none'> {
  const caps = new Set(
    lines
      .flatMap((line) => [line.startCap, line.endCap])
      .filter((cap): cap is Exclude<LineCap, 'none'> => cap !== 'none'),
  );
  const [only] = caps;
  return caps.size === 1 && only !== undefined ? only : 'arrow';
}

/**
 * The caps a choice of ends sets.
 *
 * @param ends - The ends chosen.
 * @param cap - The cap they take.
 * @returns The start and end caps.
 */
export function capsOf(
  ends: PopoverEnds,
  cap: Exclude<LineCap, 'none'>,
): { readonly startCap: LineCap; readonly endCap: LineCap } {
  if (ends === 'none') return { startCap: 'none', endCap: 'none' };
  return ends === 'end' ? { startCap: 'none', endCap: cap } : { startCap: cap, endCap: cap };
}
