import {
  BOARD_BOUND,
  findValueLimitIssues,
  INSTANCE_SCALE_MAX,
  INSTANCE_SCALE_MIN,
  LETTER_SPACING_LIMITS,
  MAX_FONT_SIZE,
  MAX_LINE_HEIGHT,
  MAX_SHADOW_BLUR,
  MAX_SHADOW_OFFSET,
  MAX_SHADOW_SPREAD,
  MAX_STROKE_DASH_LENGTH,
  MAX_STROKE_DASH_OFFSET,
  MAX_STROKE_WIDTH,
  MIN_FONT_SIZE,
  type AutoLayout,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

// Detaching a scaled instance stores what it drew: its copies, whose lengths
// `scaledObject` multiplied. A drawn length may lie past what an object may store (a 24 px font
// at 20× is 480 px; the stored limit is 400), so the detach clamps each such value into its
// stored range and reports it (clamp and report, never refuse).

/** One value a detach clamped into its stored range. */
export interface DetachClamp {
  /** The stored object that holds it. */
  readonly objectId: ObjectId;
  /** Where in the object, as a dotted path (`runs.0.style.fontSize`, `shadow.0.blur`). */
  readonly field: string;
  /** The value as the instance drew it. */
  readonly from: number;
  /** The value stored. */
  readonly to: number;
}

/** A plain record view of an object's fields while values are clamped. */
type Fields = Record<string, unknown>;

/** Collects clamps for one object as its fields are rewritten. */
class Clamper {
  readonly clamped: DetachClamp[] = [];

  constructor(private readonly objectId: ObjectId) {}

  /**
   * Clamps one number into its range, reporting it when it changes.
   *
   * @param from - The number.
   * @param field - Its dotted path in the object.
   * @param range - Its inclusive range, smallest first.
   * @returns The number to store.
   */
  number(from: number, field: string, range: readonly [number, number]): number {
    const to = Math.min(range[1], Math.max(range[0], from));
    if (to !== from) this.clamped.push({ objectId: this.objectId, field, from, to });
    return to;
  }

  /**
   * Clamps the named number fields of a record into their ranges.
   *
   * @param value - A record, or anything else (returned as it is).
   * @param path - The record's dotted path in the object, with a trailing dot or empty.
   * @param ranges - Each field's inclusive range.
   * @returns The record, new when a field was clamped.
   */
  fields(
    value: unknown,
    path: string,
    ranges: Readonly<Record<string, readonly [number, number]>>,
  ): unknown {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    let out: Fields | undefined;
    for (const [key, range] of Object.entries(ranges)) {
      const from = (value as Fields)[key];
      if (typeof from !== 'number') continue;
      const to = this.number(from, `${path}${key}`, range);
      if (to === from) continue;
      out ??= { ...(value as Fields) };
      out[key] = to;
    }
    return out ?? value;
  }
}

/** The stored ranges of a run's absolute lengths. */
const RUN_RANGES = {
  fontSize: [MIN_FONT_SIZE, MAX_FONT_SIZE],
} as const satisfies Record<string, [number, number]>;

/**
 * Clamps a run list's font sizes and px letter-spacing and line-height.
 *
 * @param clamper - The object's clamper.
 * @param runs - The runs.
 * @param path - Their dotted path, with a trailing dot.
 * @param isScaled - Whether the instance was scaled, so a run's named text style no longer
 *   matches its values and is dropped (the values stay).
 * @returns The runs, new when one changed.
 */
function clampedRuns(clamper: Clamper, runs: unknown, path: string, isScaled: boolean): unknown {
  if (!Array.isArray(runs)) return runs;
  return runs.map((run: unknown, index) => {
    if (typeof run !== 'object' || run === null) return run;
    const at = `${path}${String(index)}.style.`;
    const source = (run as Fields).style as Fields | undefined;
    if (source === undefined) return run;
    let style = clamper.fields(source, at, RUN_RANGES) as Fields;
    const spacing = style.letterSpacing as Fields | undefined;
    if (spacing?.unit === 'px') {
      const { min, max } = LETTER_SPACING_LIMITS.px;
      const value = clamper.fields(spacing, `${at}letterSpacing.`, { value: [min, max] });
      if (value !== spacing) style = { ...style, letterSpacing: value };
    }
    const height = style.lineHeight;
    if (typeof height === 'object' && height !== null && (height as Fields).unit === 'px') {
      const range: [number, number] = [Number.MIN_VALUE, MAX_LINE_HEIGHT.px];
      const value = clamper.fields(height, `${at}lineHeight.`, { value: range });
      if (value !== height) style = { ...style, lineHeight: value };
    }
    if (isScaled && style.textStyleId !== undefined) {
      style = { ...style };
      delete style.textStyleId;
    }
    return style === source ? run : { ...(run as Fields), style };
  });
}

/** The stored ranges of a shadow layer. */
const SHADOW_RANGES = {
  x: [-MAX_SHADOW_OFFSET, MAX_SHADOW_OFFSET],
  y: [-MAX_SHADOW_OFFSET, MAX_SHADOW_OFFSET],
  blur: [0, MAX_SHADOW_BLUR],
  spread: [-MAX_SHADOW_SPREAD, MAX_SHADOW_SPREAD],
} as const satisfies Record<string, [number, number]>;

/**
 * Clamps a stroke's width, a dash pattern's lengths and offset, and every shadow layer.
 *
 * @param clamper - The object's clamper.
 * @param out - The object's fields, rewritten in place.
 */
function clampStrokeAndShadow(clamper: Clamper, out: Fields): void {
  if (out.stroke !== undefined && out.stroke !== null)
    out.stroke = clamper.fields(out.stroke, 'stroke.', { width: [0, MAX_STROKE_WIDTH] });
  const dash = out.strokeDash as Fields | undefined;
  if (dash !== undefined && Array.isArray(dash.pattern)) {
    const offset = clamper.fields(dash, 'strokeDash.', {
      offset: [-MAX_STROKE_DASH_OFFSET, MAX_STROKE_DASH_OFFSET],
    }) as Fields;
    const pattern = (dash.pattern as number[]).map((length, index) =>
      clamper.number(length, `strokeDash.pattern.${String(index)}`, [0, MAX_STROKE_DASH_LENGTH]),
    );
    out.strokeDash = { ...offset, pattern };
  }
  if (Array.isArray(out.shadow))
    out.shadow = out.shadow.map((layer: unknown, index) =>
      clamper.fields(layer, `shadow.${String(index)}.`, SHADOW_RANGES),
    );
  else if (out.shadow !== undefined && out.shadow !== null)
    out.shadow = clamper.fields(out.shadow, 'shadow.', SHADOW_RANGES);
}

/**
 * Clamps an auto-layout's gap (within the board bound either way) and padding (0 to it), and a
 * shape's or frame's corner radius (one, or each of a frame's four) to the board bound.
 *
 * @param clamper - The object's clamper.
 * @param out - The object's fields, rewritten in place.
 */
function clampLayoutAndRadius(clamper: Clamper, out: Fields): void {
  const layout = out.autoLayout as Fields | undefined;
  if (layout !== undefined) {
    const gapped = clamper.fields(layout, 'autoLayout.', { gap: [-BOARD_BOUND, BOARD_BOUND] });
    const side: readonly [number, number] = [0, BOARD_BOUND];
    const padding = clamper.fields(layout.padding, 'autoLayout.padding.', {
      top: side,
      right: side,
      bottom: side,
      left: side,
    });
    out.autoLayout = { ...(gapped as Fields), padding };
  }
  const radius = out.cornerRadius;
  if (typeof radius === 'number')
    out.cornerRadius = clamper.number(radius, 'cornerRadius', [0, BOARD_BOUND]);
  else if (Array.isArray(radius))
    out.cornerRadius = radius.map((corner: number, index) =>
      clamper.number(corner, `cornerRadius.${String(index)}`, [0, BOARD_BOUND]),
    );
}

/**
 * Shrinks a box whose image (an image object's, or an image paint's) would span more than the
 * board bound behind its crop: the whole source is the box over the crop's fractions, so the box
 * is scaled down, keeping its aspect, until it fits, and its width and height are reported.
 *
 * @param clamper - The object's clamper.
 * @param out - The object's fields, rewritten in place.
 */
function clampImageBehindCrop(clamper: Clamper, out: Fields): void {
  const worst = Math.max(
    0,
    ...findValueLimitIssues(out as BoardObject)
      .filter(({ path }) => path.includes('crop'))
      .map(({ magnitude }) => magnitude),
  );
  if (!(worst > BOARD_BOUND) || typeof out.width !== 'number' || typeof out.height !== 'number')
    return;
  // Just under the bound, so the product's rounding cannot leave it a hair past.
  const ratio = (BOARD_BOUND / worst) * (1 - Number.EPSILON * 4);
  for (const side of ['width', 'height'] as const) {
    const from = out[side] as number;
    out[side] = clamper.number(from, side, [0, from * ratio]);
  }
}

/**
 * A detached instance's copy as it may be stored: each drawn length past its
 * stored range clamped into it and reported (a run's font size, px letter-spacing and
 * line-height; a stroke's width; a dash's lengths and offset; a shadow layer's offset, blur and
 * spread; an auto-layout's gap and padding; a corner radius; a box whose image would pass the
 * board bound behind its crop, shrunk to fit; a nested instance's composed scale, removed when it
 * composes to 1). When the instance
 * was scaled, a named text or effect style no longer describes the copy's values, so its id is
 * dropped and the values kept. Pure.
 *
 * @param object - A materialised copy.
 * @param isScaled - Whether the detached instance's scale was other than 1.
 * @returns The copy to store, and what was clamped.
 */
export function bakedCopy(
  object: BoardObject,
  isScaled: boolean,
): { readonly object: BoardObject; readonly clamped: readonly DetachClamp[] } {
  const clamper = new Clamper(object.id);
  const out: Fields = { ...object };
  if ('runs' in out) out.runs = clampedRuns(clamper, out.runs, 'runs.', isScaled);
  const label = out.label as Fields | null | undefined;
  if (label !== undefined && label !== null)
    out.label = { ...label, runs: clampedRuns(clamper, label.runs, 'label.runs.', isScaled) };
  clampStrokeAndShadow(clamper, out);
  clampLayoutAndRadius(clamper, out);
  clampImageBehindCrop(clamper, out);
  if (isScaled) delete out.effectStyleId;
  if (object.type === 'instance' && typeof out.scale === 'number') {
    out.scale = clamper.number(out.scale, 'scale', [INSTANCE_SCALE_MIN, INSTANCE_SCALE_MAX]);
    if (out.scale === 1) delete out.scale;
  }
  return { object: out as BoardObject, clamped: clamper.clamped };
}

/**
 * An auto-layout as a scaled instance drew it: its gap and padding multiplied by
 * the scale; its modes as they are.
 *
 * @param layout - The main's auto-layout.
 * @param scale - The instance's content scale.
 * @returns The layout to store on the detached frame.
 */
export function scaledLayout(layout: AutoLayout, scale: number): AutoLayout {
  if (scale === 1) return layout;
  const { top, right, bottom, left } = layout.padding;
  return {
    ...layout,
    gap: layout.gap * scale,
    padding: { top: top * scale, right: right * scale, bottom: bottom * scale, left: left * scale },
  };
}
