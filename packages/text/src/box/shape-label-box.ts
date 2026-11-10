import type { ShapeObject } from '@canvas/schema';

import { polygonFitOf, unitPolygonInradius } from './polygon-fit.js';

// Where a shape's label sits: the box inscribed in the shape's kind, less padding. The
// renderer places labels in it and agents measure labels at its width.

/** The fields of a shape its label box depends on. */
export type ShapeLabelGeometry = Pick<
  ShapeObject,
  'kind' | 'width' | 'height' | 'cornerRadius' | 'sides'
>;

/**
 * A shape label's padding inside the kind's inscribed box on every side, world units:
 * half a sticky note's, since a label sits inside an outline rather than on paper; less in a
 * small box ({@link LABEL_PADDING_FRACTION}).
 */
export const LABEL_PADDING = 8;

/** The padding is at most this fraction of the inscribed box's shorter side. */
export const LABEL_PADDING_FRACTION = 0.15;

/**
 * The half-width and half-height, as fractions of a circle's radius, of the 2:1 rectangle
 * inscribed in it: a label's lines are wider than tall, so a polygon's or star's label box is
 * this rectangle in its inscribed circle rather than the square (2/√5 and 1/√5).
 */
const WIDE_BOX_IN_CIRCLE = { x: 2 / Math.sqrt(5), y: 1 / Math.sqrt(5) } as const;

/** A rectangle in a shape's own frame, world units, from the top-left of its box. */
export interface ShapeLabelRect {
  /** Left. */
  readonly x: number;
  /** Top. */
  readonly y: number;
  /** Width. */
  readonly width: number;
  /** Height. */
  readonly height: number;
}

/**
 * A box centred on a point of a shape's box.
 *
 * @param shape - The shape.
 * @param centreX - The box's centre from the shape's centre, world units.
 * @param centreY - Likewise down.
 * @param halfWidth - Half the box's width.
 * @param halfHeight - Half its height.
 * @returns The box, in the shape's frame.
 */
function boxAbout(
  shape: ShapeLabelGeometry,
  centreX: number,
  centreY: number,
  halfWidth: number,
  halfHeight: number,
): ShapeLabelRect {
  return {
    x: shape.width / 2 + centreX - halfWidth,
    y: shape.height / 2 + centreY - halfHeight,
    width: 2 * halfWidth,
    height: 2 * halfHeight,
  };
}

/**
 * The box a shape's label is laid out in before padding:
 * a rectangle inscribed in the kind, so the text stays inside the outline. A rectangle's whole box,
 * less what its rounded corners cut off; the largest rectangle in an ellipse (1/√2 of each
 * axis); for a diamond, polygon or star, the 2:1 rectangle in its largest centred circle (a
 * star's reaches its notches), stretched as the shape is (`polygonFitOf`), so it is inside by the
 * same affine map. Pure.
 *
 * @param shape - The shape, with its stored size.
 * @returns The box, in the shape's frame.
 */
export function shapeLabelBox(shape: ShapeLabelGeometry): ShapeLabelRect {
  const { width, height } = shape;
  switch (shape.kind) {
    case 'rectangle': {
      const radius = Math.min(shape.cornerRadius, width / 2, height / 2);
      const inset = radius * (1 - Math.SQRT1_2);
      return { x: inset, y: inset, width: width - 2 * inset, height: height - 2 * inset };
    }
    case 'ellipse':
      return boxAbout(shape, 0, 0, (width / 2) * Math.SQRT1_2, (height / 2) * Math.SQRT1_2);
    case 'diamond':
    case 'polygon':
    case 'star': {
      const sides = shape.kind === 'diamond' ? 4 : shape.sides;
      const isStar = shape.kind === 'star';
      const { centre, scale } = polygonFitOf({ x: width / 2, y: height / 2 }, sides, isStar);
      const radius = unitPolygonInradius(sides, isStar);
      const centreX = -centre.x * scale.x;
      const centreY = -centre.y * scale.y;
      const halfWidth = radius * WIDE_BOX_IN_CIRCLE.x * scale.x;
      const halfHeight = radius * WIDE_BOX_IN_CIRCLE.y * scale.y;
      return boxAbout(shape, centreX, centreY, halfWidth, halfHeight);
    }
  }
}

/**
 * The padding a label keeps inside its inscribed box: {@link LABEL_PADDING}, or less in a small
 * box, never more than {@link LABEL_PADDING_FRACTION} of its shorter side. Pure.
 *
 * @param box - The inscribed box.
 * @returns The padding, world units.
 */
export function labelPaddingOf(box: ShapeLabelRect): number {
  return Math.max(
    0,
    Math.min(LABEL_PADDING, LABEL_PADDING_FRACTION * Math.min(box.width, box.height)),
  );
}

/**
 * The width a shape's label wraps at: its inscribed box less the padding on both sides, never
 * below one world unit (`shapeLabelPlacement`'s wrapping width). Pure.
 *
 * @param shape - The shape.
 * @returns The wrapping width, world units.
 */
export function shapeLabelWrapWidth(shape: ShapeLabelGeometry): number {
  const box = shapeLabelBox(shape);
  return Math.max(1, box.width - 2 * labelPaddingOf(box));
}
