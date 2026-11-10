// Where a colour glyph's paint can land: the union of every paint's clip, in em. A
// COLRv1 paint may reach past the glyph's advance and the font's line extent (its clip box or
// clip outline does), so the raster box takes it in rather than cutting it at the canvas edge.

import type { ColourGlyphProgram, GlyphOutline } from '@canvas/text';

import type { ColourGlyphBox } from './colour-raster.js';

/** A 2D affine transform, canvas order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/**
 * The product parent × child, as the canvas composes `transform` calls.
 *
 * @param p - The parent.
 * @param m - The child.
 * @returns The product.
 */
function compose(p: Affine, m: Affine): Affine {
  return [
    p[0] * m[0] + p[2] * m[1],
    p[1] * m[0] + p[3] * m[1],
    p[0] * m[2] + p[2] * m[3],
    p[1] * m[2] + p[3] * m[3],
    p[0] * m[4] + p[2] * m[5] + p[4],
    p[1] * m[4] + p[3] * m[5] + p[5],
  ];
}

/**
 * The box round a rectangle's four corners under a transform.
 *
 * @param m - The transform.
 * @param box - The rectangle.
 * @returns The transformed rectangle's box.
 */
function transformBox(m: Affine, box: ColourGlyphBox): ColourGlyphBox {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [box.xMin, box.yMin],
    [box.xMax, box.yMin],
    [box.xMin, box.yMax],
    [box.xMax, box.yMax],
  ] as const) {
    xs.push(m[0] * x + m[2] * y + m[4]);
    ys.push(m[1] * x + m[3] * y + m[5]);
  }
  return {
    xMin: Math.min(...xs),
    yMin: Math.min(...ys),
    xMax: Math.max(...xs),
    yMax: Math.max(...ys),
  };
}

/**
 * The box round an outline's points, control points included (a curve stays inside them).
 *
 * @param outline - The outline.
 * @returns Its box, or undefined for an outline with no points.
 */
function outlineBox(outline: GlyphOutline): ColourGlyphBox | undefined {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const contour of outline.contours) {
    for (const segment of contour) {
      xs.push(segment.x0, segment.x1);
      ys.push(segment.y0, segment.y1);
      if (segment.kind === 'quadratic') {
        xs.push(segment.cx);
        ys.push(segment.cy);
      } else if (segment.kind !== 'line') {
        xs.push(segment.c1x, segment.c2x);
        ys.push(segment.c1y, segment.c2y);
      }
    }
  }
  if (xs.length === 0) return undefined;
  return {
    xMin: Math.min(...xs),
    yMin: Math.min(...ys),
    xMax: Math.max(...xs),
    yMax: Math.max(...ys),
  };
}

/**
 * Two boxes' intersection.
 *
 * @param a - One box, or undefined for the whole plane.
 * @param b - The other.
 * @returns The intersection, possibly empty (min past max).
 */
function intersect(a: ColourGlyphBox | undefined, b: ColourGlyphBox): ColourGlyphBox {
  if (a === undefined) return b;
  return {
    xMin: Math.max(a.xMin, b.xMin),
    yMin: Math.max(a.yMin, b.yMin),
    xMax: Math.min(a.xMax, b.xMax),
    yMax: Math.min(a.yMax, b.yMax),
  };
}

/**
 * Two boxes' union.
 *
 * @param a - One box, or undefined for none.
 * @param b - The other.
 * @returns The union.
 */
export function unionBox(a: ColourGlyphBox | undefined, b: ColourGlyphBox): ColourGlyphBox {
  if (a === undefined) return b;
  return {
    xMin: Math.min(a.xMin, b.xMin),
    yMin: Math.min(a.yMin, b.yMin),
    xMax: Math.max(a.xMax, b.xMax),
    yMax: Math.max(a.yMax, b.yMax),
  };
}

/**
 * Where a program's paint can land, in em, y up: the union of each fill's clip (glyph outlines
 * by their points, rectangles, both through their transforms) and each image's box. A fill with
 * no clip covers everything and adds nothing here: the glyph's own box bounds it.
 *
 * @param program - The glyph's paint.
 * @returns The box, or undefined when no paint is bounded.
 */
export function paintBounds(program: ColourGlyphProgram): ColourGlyphBox | undefined {
  const transforms: Affine[] = [IDENTITY];
  const clips: (ColourGlyphBox | undefined)[] = [undefined];
  let bounds: ColourGlyphBox | undefined;
  const add = (box: ColourGlyphBox | undefined): void => {
    if (box !== undefined && box.xMin < box.xMax && box.yMin < box.yMax) {
      bounds = unionBox(bounds, box);
    }
  };
  for (const op of program.ops) {
    const transform = transforms.at(-1) ?? IDENTITY;
    const clip = clips.at(-1);
    switch (op.op) {
      case 'push-transform':
        transforms.push(compose(transform, [op.xx, op.yx, op.xy, op.yy, op.dx, op.dy]));
        break;
      case 'pop-transform':
        if (transforms.length > 1) transforms.pop();
        break;
      case 'push-clip-glyph': {
        const box = outlineBox(op.outline);
        const empty = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
        clips.push(intersect(clip, box === undefined ? empty : transformBox(transform, box)));
        break;
      }
      case 'push-clip-rect':
        clips.push(intersect(clip, transformBox(transform, op)));
        break;
      case 'pop-clip':
        if (clips.length > 1) clips.pop();
        break;
      case 'solid':
      case 'linear':
      case 'radial':
      case 'sweep':
        add(clip);
        break;
      case 'image': {
        const box = transformBox(transform, op);
        add(clip === undefined ? box : intersect(clip, box));
        break;
      }
      case 'push-group':
      case 'pop-group':
        break;
    }
  }
  return bounds;
}
