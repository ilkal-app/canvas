import {
  isGradient,
  isImagePaint,
  isTokenRef,
  MAX_GRADIENT_STOPS,
  MIN_GRADIENT_STOPS,
  paintColorAt,
  resolveColor,
  type Gradient,
  type GradientStop,
  type Paint,
  type Rgba,
  type TokenRef,
} from '@canvas/schema';

/** The kinds of fill the paint control's segmented control offers. */
export const PAINT_KINDS = ['solid', 'linear', 'radial'] as const;

/**
 * The kind of a fill: one of {@link PAINT_KINDS}, or `image`, which the segmented
 * control offers only where an image fill can be chosen (`PaintControl`'s `imageTargets`).
 */
export type PaintKind = (typeof PAINT_KINDS)[number] | 'image';

/** The second stop's colour when a solid becomes a gradient: opaque white. */
const GRADIENT_END: Rgba = [1, 1, 1, 1];

/**
 * The colour a gradient starts from when the fill was none: opaque black, so the new gradient
 * runs black to white and is visible on either theme's canvas.
 */
export const NO_FILL_GRADIENT_START: Rgba = [0, 0, 0, 1];

/** A radial gradient's centre and radius when it is made: the box's centre, half its size. */
const RADIAL_CENTRE = { x: 0.5, y: 0.5 } as const;
const RADIAL_RADIUS = 0.5;

/**
 * The kind of a paint; a none (null) fill counts as solid, whose colour field shows None.
 *
 * @param paint - The paint, or null.
 * @returns Its kind.
 */
export function paintKindOf(paint: Paint | null): PaintKind {
  if (isImagePaint(paint)) return 'image';
  return isGradient(paint) ? paint.type : 'solid';
}

/**
 * What a colour token is as a gradient's first stop (gradient stops take no tokens, v1): its
 * value, resolved by the caller in the board's table and the object's mode.
 */
export type TokenResolver = (token: TokenRef) => Rgba;

/**
 * The built-in defaults of a token in the light mode, for a caller with no board.
 *
 * @param token - The token.
 * @returns Its value.
 */
const lightDefaults: TokenResolver = (token) => resolveColor(token, 'light');

/**
 * The stops a paint gives a gradient made from it: a gradient's own, or the solid colour (black
 * for none; a colour token's value) to white.
 *
 * @param paint - The paint, or null.
 * @param resolve - A colour token's value.
 * @returns The stops.
 */
function stopsFrom(paint: Paint | null, resolve: TokenResolver): GradientStop[] {
  if (isGradient(paint)) return paint.stops;
  // A colour token starts the gradient at its value (`resolve`); an image fill has no
  // colour of its own, so it starts one as no fill does.
  const start = isTokenRef(paint)
    ? resolve(paint)
    : Array.isArray(paint)
      ? paint
      : NO_FILL_GRADIENT_START;
  return [
    { offset: 0, color: start },
    { offset: 1, color: GRADIENT_END },
  ];
}

/**
 * A paint switched to another kind: a solid becomes a gradient from its
 * colour to white (a colour token from its value, `resolve`); linear and radial keep each
 * other's stops (linear at angle 0, radial centred with radius 0.5); a gradient becomes solid
 * in its first stop's colour; an image fill becomes none as a solid and a gradient from black as
 * a gradient. A paint already of the kind is returned as is, so a mixed selection's
 * objects of that kind are left alone. Pure.
 *
 * @param paint - The paint, or null for none.
 * @param kind - The kind wanted.
 * @param resolve - A colour token's value; its light built-in default if absent.
 * @returns The paint of that kind; null only for a none switched to solid.
 */
export function switchPaintKind(
  paint: Paint | null,
  kind: PaintKind,
  resolve: TokenResolver = lightDefaults,
): Paint | null {
  if (paintKindOf(paint) === kind) return paint;
  if (kind === 'image') return paint;
  if (kind === 'solid') {
    if (isGradient(paint)) return paint.stops[0]?.color ?? null;
    return Array.isArray(paint) || isTokenRef(paint) ? paint : null;
  }
  const stops = stopsFrom(paint, resolve);
  if (kind === 'linear') return { type: 'linear', angle: 0, stops };
  return { type: 'radial', center: RADIAL_CENTRE, radius: RADIAL_RADIUS, stops };
}

/** A gradient after a stop edit, and the stop to keep selected. */
export interface StopEdit {
  /** The edited gradient. */
  readonly gradient: Gradient;
  /** The index of the stop to select in it. */
  readonly selected: number;
}

/**
 * A stop's index within a gradient's stops, clamped, so a selection survives an undo that
 * removed stops.
 *
 * @param gradient - The gradient.
 * @param index - The index wanted.
 * @returns An index of one of its stops.
 */
export function clampStopIndex(gradient: Gradient, index: number): number {
  return Math.min(Math.max(0, Math.trunc(index)), gradient.stops.length - 1);
}

/**
 * The colour of a gradient's stops at an offset, interpolated in premultiplied sRGB as the
 * renderer does (`paintColorAt` along a linear gradient at angle 0, where `u` is the offset).
 *
 * @param stops - The stops.
 * @param offset - Where along them, 0 to 1.
 * @returns The straight-alpha colour there.
 */
function colourAt(stops: readonly GradientStop[], offset: number): Rgba {
  return paintColorAt({ type: 'linear', angle: 0, stops: [...stops] }, offset, 0.5);
}

/**
 * Whether another stop can be added (fewer than {@link MAX_GRADIENT_STOPS}).
 *
 * @param gradient - The gradient.
 * @returns True when a stop can be added.
 */
export function canAddStop(gradient: Gradient): boolean {
  return gradient.stops.length < MAX_GRADIENT_STOPS;
}

/**
 * Whether a stop can be removed (more than {@link MIN_GRADIENT_STOPS}).
 *
 * @param gradient - The gradient.
 * @returns True when a stop can be removed.
 */
export function canRemoveStop(gradient: Gradient): boolean {
  return gradient.stops.length > MIN_GRADIENT_STOPS;
}

/**
 * Adds a stop midway between the selected stop and its neighbour (the next one, or the previous
 * for the last), coloured as the gradient is there; the new stop is selected. Pure.
 *
 * @param gradient - The gradient.
 * @param selected - The selected stop's index.
 * @returns The edit, or undefined at {@link MAX_GRADIENT_STOPS} stops.
 */
export function addStop(gradient: Gradient, selected: number): StopEdit | undefined {
  if (!canAddStop(gradient)) return undefined;
  const { stops } = gradient;
  const at = clampStopIndex(gradient, selected);
  const after = at + 1 < stops.length ? at : at - 1;
  const [left, right] = [stops[after], stops[after + 1]];
  if (left === undefined || right === undefined) return undefined;
  const offset = (left.offset + right.offset) / 2;
  const stop: GradientStop = { offset, color: colourAt(stops, offset) };
  const next = [...stops.slice(0, after + 1), stop, ...stops.slice(after + 1)];
  return { gradient: { ...gradient, stops: next }, selected: after + 1 };
}

/**
 * Removes the selected stop; its neighbour before it (or the new first) is selected. Pure.
 *
 * @param gradient - The gradient.
 * @param selected - The selected stop's index.
 * @returns The edit, or undefined at {@link MIN_GRADIENT_STOPS} stops.
 */
export function removeStop(gradient: Gradient, selected: number): StopEdit | undefined {
  if (!canRemoveStop(gradient)) return undefined;
  const at = clampStopIndex(gradient, selected);
  const stops = [...gradient.stops.slice(0, at), ...gradient.stops.slice(at + 1)];
  return { gradient: { ...gradient, stops }, selected: Math.max(0, at - 1) };
}

/**
 * Moves a stop to another offset, clamped to [0, 1], and re-sorts the stops so offsets stay
 * non-decreasing; the moved stop stays selected (placed after stops already at its offset when
 * it moves right, before them when it moves left). Pure.
 *
 * @param gradient - The gradient.
 * @param selected - The moved stop's index.
 * @param offset - Its new offset.
 * @returns The edit.
 */
export function moveStop(gradient: Gradient, selected: number, offset: number): StopEdit {
  const at = clampStopIndex(gradient, selected);
  const moved = gradient.stops[at];
  if (moved === undefined) return { gradient, selected: at };
  const target = Math.min(1, Math.max(0, offset));
  const rest = [...gradient.stops.slice(0, at), ...gradient.stops.slice(at + 1)];
  const isRightward = target >= moved.offset;
  const insertAt = rest.findIndex((stop) =>
    isRightward ? stop.offset > target : stop.offset >= target,
  );
  const index = insertAt === -1 ? rest.length : insertAt;
  const stops = [...rest.slice(0, index), { ...moved, offset: target }, ...rest.slice(index)];
  return { gradient: { ...gradient, stops }, selected: index };
}

/**
 * Recolours one stop. Pure.
 *
 * @param gradient - The gradient.
 * @param selected - The stop's index.
 * @param color - Its new colour.
 * @returns The gradient.
 */
export function recolourStop(gradient: Gradient, selected: number, color: Rgba): Gradient {
  const at = clampStopIndex(gradient, selected);
  const stops = gradient.stops.map((stop, index) => (index === at ? { ...stop, color } : stop));
  return { ...gradient, stops };
}

/**
 * An angle in degrees as the stored radians, normalised into (−π, π]: 180°
 * and −180° are both π. Divides before multiplying by π so whole fractions of a turn are exact
 * (90° is exactly π/2).
 *
 * @param degrees - The angle in degrees, any finite value.
 * @returns Radians in (−π, π].
 */
export function degreesToAngle(degrees: number): number {
  let turned = degrees % 360;
  if (turned > 180) turned -= 360;
  if (turned <= -180) turned += 360;
  return (turned / 180) * Math.PI;
}

/**
 * A stored angle in degrees, as the panel shows it, rounded to hundredths.
 *
 * @param angle - Radians.
 * @returns Degrees.
 */
export function angleToDegrees(angle: number): number {
  return Math.round(((angle * 180) / Math.PI) * 100) / 100;
}

/**
 * A fraction of the box as the panel shows it: a percentage, to two decimals.
 *
 * @param fraction - The stored fraction (0.25).
 * @returns The percentage (25).
 */
export function fractionToPercent(fraction: number): number {
  return Math.round(fraction * 10_000) / 100;
}

/**
 * A percentage the panel took, as the fraction of the box it stores.
 *
 * @param percent - The percentage (25).
 * @returns The fraction (0.25).
 */
export function percentToFraction(percent: number): number {
  return percent / 100;
}
