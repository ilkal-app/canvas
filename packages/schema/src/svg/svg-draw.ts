// Drawing one SVG element as board objects: a shape where one draws it exactly, else
// one or two paths, with its fill and stroke resolved. Pure.
import type { Rgba } from '../fields/color.js';
import type { Paint } from '../fields/paint.js';
import { mapPoint, type AffineMap } from '../geometry/affine-map.js';
import { pathBounds } from '../geometry/local-bounds.js';

import { nonzeroDiffersFromEvenOdd } from './svg-fill-rule.js';
import { IDENTITY, mapSubpath } from './svg-geometry.js';
import { gradientMiddleColor, gradientPaint, type GradientFrame } from './svg-gradient.js';
import { hasOpenSubpath, placeNetwork, subpathsToNetwork } from './svg-network.js';
import { outlineOf, tightBounds } from './svg-outline.js';
import { resolvePaint, type ResolvedPaint } from './svg-paint.js';
import { boardStrokeStyle } from './svg-stroke-style.js';
import { boardStroke, rigidScale, sameScale, type Drawing } from './svg-stroke.js';
import type { SvgStyle } from './svg-style.js';
import { readColor, readLength } from './svg-values.js';
import { add, report, type Walk } from './svg-walk.js';
import type { SvgElement } from './svg-xml.js';

/**
 * The colour `currentColor` stands for under a style.
 *
 * @param style - The computed style.
 * @param walk - The walk, for the root's colour.
 * @returns The colour.
 */
function currentColorOf(style: SvgStyle, walk: Walk): Rgba {
  return readColor(style.color) ?? walk.currentColor;
}

/** A paint the board draws: an unsupported one has become its fallback colour or none. */
type DrawnPaint = Exclude<ResolvedPaint, { readonly kind: 'unsupported' }>;

/**
 * A paint for one object: the board paint, or null for none.
 *
 * @param resolved - The paint.
 * @param frame - Where a gradient is drawn, and the opacity.
 * @param walk - Where a gradient's approximations are reported.
 * @returns The board paint.
 */
function boardPaint(resolved: DrawnPaint, frame: GradientFrame, walk: Walk): Paint | null {
  switch (resolved.kind) {
    case 'none':
      return null;
    case 'color':
      return withAlpha(resolved.color, frame.opacity);
    default: {
      const outcome = gradientPaint(resolved.element, walk.ids, frame);
      for (const issue of outcome.issues) report(walk, issue);
      return outcome.paint;
    }
  }
}

/**
 * A colour with its alpha multiplied.
 *
 * @param color - The colour.
 * @param opacity - The factor.
 * @returns The new colour.
 */
function withAlpha(color: Rgba, opacity: number): Rgba {
  return [color[0], color[1], color[2], color[3] * opacity];
}

/**
 * Draws an element as a shape when one draws it exactly: a rectangle (with a round corner
 * radius) or a circle or ellipse, under a transform without skew; stroked only when the stroke is
 * opaque, as wide on every side, solid, and (on a sharp rectangle) mitred. A dashed stroke, or a
 * sharp rectangle joined round or bevelled, is a path instead, which carries the dash and join.
 * The shape keeps the element's box and its outline is centred on the edge
 * (`strokeAlign: 'center'`) as SVG strokes are, so a gradient fill spans the
 * element's own box (SVG's `objectBoundingBox`) and the outline's outer antialiased edge shows no
 * fill.
 *
 * @param drawing - The element.
 * @param fill - The fill's resolved paint.
 * @param stroke - The stroke's resolved paint.
 * @param walk - The walk.
 * @returns Whether it was drawn as a shape.
 */
function drawAsShape(drawing: Drawing, fill: DrawnPaint, stroke: DrawnPaint, walk: Walk): boolean {
  const { outline, ctm, style } = drawing;
  const box = outline.box;
  const rigid = rigidScale(ctm);
  if (box === undefined || rigid === undefined) return false;
  const isUniform = sameScale(rigid.sx, rigid.sy);
  if (box.radius > 0 && !isUniform) return false;
  const isCircle = box.kind === 'ellipse' && box.width === box.height && isUniform;
  const strokeOpacity = style.strokeOpacity * drawing.opacity;
  if (stroke.kind !== 'none') {
    const isOpaque = stroke.kind === 'color' && stroke.color[3] * strokeOpacity === 1;
    const canMitre =
      box.kind === 'ellipse' ||
      box.radius > 0 ||
      (style.strokeLinejoin === 'miter' && style.strokeMiterlimit >= Math.SQRT2);
    const isPlain = style.strokeDasharray === 'none' && readLength(style.strokeWidth) !== undefined;
    if (!isOpaque || !isUniform || (box.kind === 'ellipse' && !isCircle) || !canMitre || !isPlain) {
      return false;
    }
  }
  const strokeColorValue = stroke.kind === 'color' ? withAlpha(stroke.color, strokeOpacity) : null;
  const boardStrokeValue = boardStroke(drawing, strokeColorValue, walk);
  const { sx, sy, rotation, isMirrored } = rigid;
  const { x, y } = mapPoint(ctm, { x: box.x, y: isMirrored ? box.y + box.height : box.y });
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const width = box.width * sx;
  const height = box.height * sy;
  const unitBox: AffineMap = {
    a: width * cos,
    b: width * sin,
    c: -height * sin,
    d: height * cos,
    x,
    y,
  };
  const fillPaint = boardPaint(
    fill,
    gradientFrame(drawing, unitBox, style.fillOpacity, walk),
    walk,
  );
  add(walk, {
    type: 'shape',
    kind: box.kind,
    x,
    y,
    rotation,
    width,
    height,
    stroke: boardStrokeValue,
    ...(boardStrokeValue === null ? {} : { strokeAlign: 'center' as const }),
    fill: fillPaint,
    cornerRadius: box.radius > 0 ? box.radius * sx : 0,
    sides: 4,
    label: null,
  });
  return true;
}

/**
 * The frame a gradient of an element is drawn in.
 *
 * @param drawing - The element.
 * @param unitBox - The object's unit box in the group's frame.
 * @param paintOpacity - The fill or stroke opacity.
 * @param walk - The walk.
 * @returns The frame.
 */
function gradientFrame(
  drawing: Drawing,
  unitBox: AffineMap,
  paintOpacity: number,
  walk: Walk,
): GradientFrame {
  return {
    ctm: drawing.ctm,
    bbox: tightBounds(drawing.outline.subpaths),
    unitBox,
    opacity: paintOpacity * drawing.opacity,
    currentColor: currentColorOf(drawing.style, walk),
  };
}

/**
 * Draws an element's outline as one or two path objects: one when every subpath is closed or the
 * element has only a fill or only a stroke, else a fill (its subpaths closed, as SVG fills them)
 * under a stroke (open as drawn).
 *
 * @param drawing - The element.
 * @param fill - The fill's resolved paint.
 * @param stroke - The stroke's resolved paint.
 * @param walk - The walk.
 */
function drawAsPaths(drawing: Drawing, fill: DrawnPaint, stroke: DrawnPaint, walk: Walk): void {
  const { ctm, style } = drawing;
  const subpaths = drawing.outline.subpaths.map((subpath) => mapSubpath(subpath, ctm));
  const strokeFrame = gradientFrame(drawing, IDENTITY, style.strokeOpacity, walk);
  let color: Rgba | null;
  if (stroke.kind === 'gradient') {
    report(walk, {
      feature: 'stroke gradient',
      detail: 'strokes are solid on the board; drawn as the colour halfway along it',
    });
    color = gradientMiddleColor(stroke.element, walk.ids, strokeFrame);
  } else {
    color = boardPaint(stroke, strokeFrame, walk) as Rgba | null;
  }
  const strokeValue = boardStroke(drawing, color, walk);
  const strokeStyle = strokeValue === null ? {} : boardStrokeStyle(drawing, walk);
  const hasFill = fill.kind !== 'none';
  if (hasFill && style.fillRule === 'nonzero') {
    const isDifferent = nonzeroDiffersFromEvenOdd(subpaths, walk.fillRuleBudget);
    if (isDifferent !== false) {
      report(walk, {
        feature: 'fill-rule',
        detail:
          isDifferent === undefined
            ? 'too complex to check; nonzero is drawn even-odd'
            : 'overlapping or self-crossing outlines are filled even-odd, not nonzero',
      });
    }
  }
  const shouldSplit = hasFill && strokeValue !== null && hasOpenSubpath(subpaths);
  const parts = shouldSplit
    ? [
        { shouldCloseAll: true, withFill: true, withStroke: false },
        { shouldCloseAll: false, withFill: false, withStroke: true },
      ]
    : [{ shouldCloseAll: hasFill && strokeValue === null, withFill: hasFill, withStroke: true }];
  for (const part of parts) {
    const built = subpathsToNetwork(subpaths, part.shouldCloseAll);
    const network = placeNetwork(built);
    if (network.segments.length === 0) continue;
    const bounds = pathBounds(network);
    const unitBox: AffineMap = {
      a: bounds.width,
      b: 0,
      c: 0,
      d: bounds.height,
      x: network.x + bounds.x,
      y: network.y + bounds.y,
    };
    const fillPaint =
      part.withFill && built.loops > 0 && bounds.width > 0 && bounds.height > 0
        ? boardPaint(fill, gradientFrame(drawing, unitBox, style.fillOpacity, walk), walk)
        : null;
    const partStroke = part.withStroke ? strokeValue : null;
    if (fillPaint === null && partStroke === null) continue;
    add(walk, {
      type: 'path',
      x: network.x,
      y: network.y,
      rotation: 0,
      vertices: [...network.vertices],
      segments: [...network.segments],
      stroke: partStroke,
      ...(partStroke === null ? {} : strokeStyle),
      fill: fillPaint,
    });
  }
}

/**
 * Draws one drawable element: its outline as a shape where exact, else as paths.
 *
 * @param element - The element.
 * @param style - Its computed style.
 * @param ctm - From its user space to the group's frame.
 * @param opacity - Its ancestors' opacity.
 * @param walk - The walk.
 */
export function drawElement(
  element: SvgElement,
  style: SvgStyle,
  ctm: AffineMap,
  opacity: number,
  walk: Walk,
): void {
  if (style.visibility !== 'visible') return;
  const outline = outlineOf(element, walk);
  if (outline === undefined || outline.subpaths.length === 0) return;
  if (style.marker !== 'none') {
    report(walk, { feature: 'marker', detail: 'markers are not drawn' });
  }
  const currentColor = currentColorOf(style, walk);
  // A paint the board cannot draw is reported, and drawn as its fallback colour or not at all.
  const drawn = (paint: ResolvedPaint): DrawnPaint => {
    if (paint.kind !== 'unsupported') return paint;
    report(walk, paint.issue);
    return paint.fallback === null ? { kind: 'none' } : { kind: 'color', color: paint.fallback };
  };
  const fill = drawn(
    element.name === 'line' ? { kind: 'none' } : resolvePaint(style.fill, currentColor, walk.ids),
  );
  const stroke = drawn(resolvePaint(style.stroke, currentColor, walk.ids));
  if (fill.kind === 'none' && stroke.kind === 'none') return;
  if (opacity < 1 && fill.kind !== 'none' && stroke.kind !== 'none') {
    report(walk, {
      feature: 'opacity',
      detail: 'opacity is applied to the fill and the stroke separately',
    });
  }
  const drawing: Drawing = { element, outline, style, ctm, opacity };
  if (!drawAsShape(drawing, fill, stroke, walk)) drawAsPaths(drawing, fill, stroke, walk);
}
