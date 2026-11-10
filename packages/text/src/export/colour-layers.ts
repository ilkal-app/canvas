// A colour glyph as vector layers: its paint program replayed into painted regions,
// each a clip's outline with a flat colour or a gradient, or the bitmap a strike draws. Pure.
import type { GlyphOutline } from '../font/glyph-outline.js';
import type { LayoutRun } from '../layout/text-layout.js';
import type {
  ColourGlyphComposite,
  ColourGlyphExtend,
  ColourGlyphOp,
  ColourGlyphProgram,
  ColourGlyphRgba,
  ColourGlyphStop,
} from '../shaping/colour-glyph.js';

import {
  composeAffine,
  glyphPathData,
  glyphPdfPath,
  IDENTITY_AFFINE,
  type Affine,
} from './glyph-path-data.js';

/** A layer's or glyph's colour: a colour glyph's own, or the text run's. */
export type VectorFill = ColourGlyphRgba | LayoutRun['color'];

/** One stop of an exported gradient; a foreground stop already holds the run's colour. */
export interface VectorGradientStop {
  /** Where along the gradient, 0 at its start and 1 at its end. */
  readonly offset: number;
  /** The colour there. */
  readonly color: VectorFill;
  /** A foreground stop's paint alpha, which multiplies the run colour's own (0..1). */
  readonly alpha?: number;
}

/** What every exported gradient carries: its colour line and its placement. */
interface GradientLine {
  /** How the colour line continues past its ends. */
  readonly extend: ColourGlyphExtend;
  /** The colour line's stops, in offset order. */
  readonly stops: readonly VectorGradientStop[];
  /** Em to the text box (y down), for a writer's `gradientTransform` or pattern matrix. */
  readonly transform: Affine;
}

/** A linear gradient in em, its end already folding in COLRv1's rotation point. */
export interface VectorLinearGradient extends GradientLine {
  /** Discriminates the gradients. */
  readonly kind: 'linear';
  /** Start x. */
  readonly x0: number;
  /** Start y. */
  readonly y0: number;
  /** End x. */
  readonly x1: number;
  /** End y. */
  readonly y1: number;
}

/** A two-circle radial gradient in em. */
export interface VectorRadialGradient extends GradientLine {
  /** Discriminates the gradients. */
  readonly kind: 'radial';
  /** Start centre x. */
  readonly x0: number;
  /** Start centre y. */
  readonly y0: number;
  /** Start radius. */
  readonly r0: number;
  /** End centre x. */
  readonly x1: number;
  /** End centre y. */
  readonly y1: number;
  /** End radius. */
  readonly r1: number;
}

/** A sweep (conic) gradient in em, angles in radians as HarfBuzz gives them. */
export interface VectorSweepGradient extends GradientLine {
  /** Discriminates the gradients. */
  readonly kind: 'sweep';
  /** Centre x. */
  readonly x0: number;
  /** Centre y. */
  readonly y0: number;
  /** Where the colour line starts. */
  readonly startAngle: number;
  /** Where it ends. */
  readonly endAngle: number;
}

/** A colour glyph's gradient, in em with the transform that places it in the text box. */
export type VectorGradient = VectorLinearGradient | VectorRadialGradient | VectorSweepGradient;

/** A region in the text box, as SVG path data and PDF path operators (filled non-zero). */
export interface VectorRegion {
  /** The SVG path data. */
  readonly d: string;
  /** The PDF path operators. */
  readonly pdf: string;
}

/**
 * One painted layer of a colour glyph: the innermost clip's region (`d`, `pdf`), cut by every
 * outer clip still pushed, filled with a flat colour or a gradient, inside the groups it was
 * painted in.
 */
export interface VectorLayer extends VectorRegion {
  /** The outer clips the region is further cut by, outermost first; empty when none. */
  readonly clips: readonly VectorRegion[];
  /** Its flat colour, for a solid paint. */
  readonly fill?: VectorFill;
  /** A foreground solid's paint alpha, which multiplies the run colour's own (0..1). */
  readonly fillAlpha?: number;
  /** Its gradient, for a gradient paint. */
  readonly gradient?: VectorGradient;
  /** The groups it was painted in, outermost first, as indices into the glyph's `groups`. */
  readonly groups: readonly number[];
}

/**
 * A group of a colour glyph's layers, composited onto what is under it with a mode: a writer
 * nests the layers whose `groups` list it (SVG `mix-blend-mode` in an isolated `<g>`, a PDF
 * transparency group with a blend mode).
 */
export interface VectorGroup {
  /** How the group composites; `src-over` is plain painting. */
  readonly mode: ColourGlyphComposite;
  /** The group it sits in, or null at the glyph's top level. */
  readonly parent: number | null;
}

/** A bitmap colour glyph (sbix, CBDT), placed in the text box. */
export interface VectorImage {
  /** The PNG file, when the strike holds PNGs. */
  readonly png?: Uint8Array;
  /** Raw BGRA pixels, when the strike holds those. */
  readonly bgra?: Uint8Array;
  /** The bitmap's width in pixels. */
  readonly pixelWidth: number;
  /** The bitmap's height in pixels. */
  readonly pixelHeight: number;
  /** The box's left edge, in the text box. */
  readonly x: number;
  /** The box's top edge, in the text box (y down). */
  readonly y: number;
  /** The box's width. */
  readonly width: number;
  /** The box's height. */
  readonly height: number;
}

/** A clip pushed while replaying (a glyph or a rectangle), with the transform at its push. */
interface Clip {
  /** The clip's region, in em. */
  readonly outline: GlyphOutline;
  /** Em to the glyph's em frame at the push. */
  readonly transform: Affine;
}

/** The state of a replay: transforms and clips pushed, layers painted, the first bitmap. */
interface Replay {
  /** Em to the text box for the glyph. */
  readonly placement: Affine;
  /** The run's colour, for foreground paints. */
  readonly fill: VectorFill;
  /** The transforms pushed, each already composed with those under it. */
  readonly transforms: Affine[];
  /** The clips pushed. */
  readonly clips: Clip[];
  /** The layers painted. */
  readonly layers: VectorLayer[];
  /** The groups opened, their modes set when each closes. */
  readonly groups: { mode: ColourGlyphComposite; readonly parent: number | null }[];
  /** The groups open now, outermost first. */
  readonly open: number[];
  /** The first bitmap drawn, placed. */
  image?: VectorImage;
}

/**
 * A rectangle as a closed outline, so clip rectangles serialise as glyphs do.
 *
 * @param op - The clip rectangle, in em.
 * @returns The outline.
 */
function rectOutline(op: Extract<ColourGlyphOp, { op: 'push-clip-rect' }>): GlyphOutline {
  const { xMin, yMin, xMax, yMax } = op;
  const line = (x0: number, y0: number, x1: number, y1: number) =>
    ({ kind: 'line', x0, y0, x1, y1 }) as const;
  return {
    contours: [
      [
        line(xMin, yMin, xMax, yMin),
        line(xMax, yMin, xMax, yMax),
        line(xMax, yMax, xMin, yMax),
        line(xMin, yMax, xMin, yMin),
      ],
    ],
  };
}

/**
 * A linear gradient's effective end, folding in COLRv1's rotation point: p1 projected onto the
 * line through p0 perpendicular to p0→p2 (p1 itself when p2 is p0).
 *
 * @param op - The linear paint.
 * @returns The end point.
 */
function linearEnd(op: Extract<ColourGlyphOp, { op: 'linear' }>): { x: number; y: number } {
  const nx = -(op.y2 - op.y0);
  const ny = op.x2 - op.x0;
  const length = nx * nx + ny * ny;
  if (length === 0) return { x: op.x1, y: op.y1 };
  const scale = ((op.x1 - op.x0) * nx + (op.y1 - op.y0) * ny) / length;
  return { x: op.x0 + nx * scale, y: op.y0 + ny * scale };
}

/**
 * A bitmap op's box in the text box: its em corners under the transform, as an axis-aligned box.
 *
 * @param op - The image op.
 * @param transform - Em to the text box.
 * @returns The placed image.
 */
function placedImage(op: Extract<ColourGlyphOp, { op: 'image' }>, transform: Affine): VectorImage {
  const { a, b, c, d, e, f } = transform;
  const corners = [
    { x: op.xMin, y: op.yMin },
    { x: op.xMax, y: op.yMin },
    { x: op.xMax, y: op.yMax },
    { x: op.xMin, y: op.yMax },
  ].map(({ x, y }) => ({ x: a * x + c * y + e, y: b * x + d * y + f }));
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    ...(op.format === 'png' ? { png: op.bytes } : { bgra: op.bytes }),
    pixelWidth: op.width,
    pixelHeight: op.height,
    ...{ x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y },
  };
}

/**
 * The transform at the top of a replay's stack.
 *
 * @param state - The replay.
 * @returns Em to the glyph's em frame now: the identity when nothing is pushed.
 */
function currentOf(state: Replay): Affine {
  return state.transforms[state.transforms.length - 1] ?? IDENTITY_AFFINE;
}

/**
 * Fills a replay's innermost clip with a paint; a paint with no clip paints nothing.
 *
 * @param state - The replay.
 * @param paint - The flat colour or gradient.
 */
function paint(state: Replay, paint: Pick<VectorLayer, 'fill' | 'fillAlpha' | 'gradient'>): void {
  const regions = state.clips.map((clip) => {
    const toBox = composeAffine(state.placement, clip.transform);
    return { d: glyphPathData(clip.outline, toBox), pdf: glyphPdfPath(clip.outline, toBox) };
  });
  const region = regions.pop();
  if (region === undefined) return;
  state.layers.push({ ...region, clips: regions, ...paint, groups: [...state.open] });
}

/**
 * A gradient paint as an exported gradient, its stops' foreground colour the run's.
 *
 * @param state - The replay, for the transform and the run's colour.
 * @param op - The gradient paint.
 * @returns The gradient.
 */
function gradientOf(
  state: Replay,
  op: Extract<ColourGlyphOp, { op: 'linear' | 'radial' | 'sweep' }>,
): VectorGradient {
  const line = {
    extend: op.extend,
    stops: op.stops.map(({ offset, color, isForeground }: ColourGlyphStop) =>
      isForeground ? { offset, color: state.fill, alpha: color.a } : { offset, color },
    ),
    transform: composeAffine(state.placement, currentOf(state)),
  };
  if (op.op === 'linear') {
    const end = linearEnd(op);
    return { kind: 'linear', x0: op.x0, y0: op.y0, x1: end.x, y1: end.y, ...line };
  }
  if (op.op === 'radial') {
    const { x0, y0, r0, x1, y1, r1 } = op;
    return { kind: 'radial', x0, y0, r0, x1, y1, r1, ...line };
  }
  const { x0, y0, startAngle, endAngle } = op;
  return { kind: 'sweep', x0, y0, startAngle, endAngle, ...line };
}

/**
 * Replays one op.
 *
 * @param state - The replay.
 * @param op - The op.
 */
function step(state: Replay, op: ColourGlyphOp): void {
  switch (op.op) {
    case 'push-transform': {
      const matrix = { a: op.xx, b: op.yx, c: op.xy, d: op.yy, e: op.dx, f: op.dy };
      state.transforms.push(composeAffine(currentOf(state), matrix));
      return;
    }
    case 'pop-transform':
      state.transforms.pop();
      return;
    case 'push-clip-glyph':
      state.clips.push({ outline: op.outline, transform: currentOf(state) });
      return;
    case 'push-clip-rect':
      state.clips.push({ outline: rectOutline(op), transform: currentOf(state) });
      return;
    case 'pop-clip':
      state.clips.pop();
      return;
    case 'solid':
      paint(
        state,
        op.isForeground ? { fill: state.fill, fillAlpha: op.color.a } : { fill: op.color },
      );
      return;
    case 'linear':
    case 'radial':
    case 'sweep':
      paint(state, { gradient: gradientOf(state, op) });
      return;
    case 'image':
      state.image ??= placedImage(op, composeAffine(state.placement, currentOf(state)));
      return;
    case 'push-group':
      state.open.push(state.groups.length);
      state.groups.push({ mode: 'src-over', parent: state.open.at(-2) ?? null });
      return;
    case 'pop-group': {
      const group = state.groups[state.open.pop() ?? -1];
      if (group !== undefined) group.mode = op.mode;
      return;
    }
  }
}

/** A colour glyph replayed: its layers in paint order, its groups, and its first bitmap. */
export interface ColourLayers {
  /** The painted layers, in paint order. */
  readonly layers: readonly VectorLayer[];
  /** The groups the layers name, with their composite modes. */
  readonly groups: readonly VectorGroup[];
  /** The first bitmap the program draws, placed. */
  readonly image?: VectorImage;
}

/**
 * A colour program replayed into layers: each paint fills its innermost clip (a glyph, or a
 * rectangle) cut by the outer clips, under the transforms pushed so far, inside the groups open
 * (each with its composite mode, for the writer to apply). A foreground paint takes the run's
 * colour with the paint's alpha.
 *
 * @param program - The program.
 * @param placement - Em to the text box for the glyph.
 * @param fill - The run's colour, for foreground paints.
 * @returns The layers, groups and bitmap.
 */
export function colourLayers(
  program: ColourGlyphProgram,
  placement: Affine,
  fill: VectorFill,
): ColourLayers {
  const state: Replay = {
    ...{ placement, fill, transforms: [], clips: [], layers: [], groups: [], open: [] },
  };
  for (const op of program.ops) step(state, op);
  const groups = state.groups.map(({ mode, parent }) => ({ mode, parent }));
  return state.image === undefined
    ? { layers: state.layers, groups }
    : { layers: state.layers, groups, image: state.image };
}
