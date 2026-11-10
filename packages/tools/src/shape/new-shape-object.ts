import type { InkableColor, Paint, ShapeObject } from '@canvas/schema';

import { copyInkableColor } from '../ink/creation-ink.js';

/** An outline as a style holds it: a colour and a width, world units. */
export interface NewShapeStroke {
  /**
   * The colour, straight alpha, or `ink`: the default, which the shape tool resolves where the
   * creation starts (`creationColor`).
   */
  readonly color: InkableColor;
  /** The width, world units, greater than 0 and at most 64. */
  readonly width: number;
}

/** The style a new shape is made in: the shape tool's (its defaults, the person's choices). */
export interface NewShapeStyle {
  /** Which primitive: the last one picked. */
  readonly kind: ShapeObject['kind'];
  /** The fill, a colour or a gradient, or null for none. */
  readonly fill: Paint | null;
  /** The outline, or null for none. */
  readonly stroke: NewShapeStroke | null;
  /** A rectangle's corner rounding, world units. */
  readonly cornerRadius: number;
  /** A polygon's sides or a star's points, 3 to 64. */
  readonly sides: number;
}

/**
 * The shape tool's own style when the shell gives none: a rectangle,
 * filled pale blue with a 2-unit `ink` outline (resolved where the creation starts),
 * sharp corners, five sides or points. Frozen.
 */
export const DEFAULT_SHAPE_STYLE: NewShapeStyle = Object.freeze({
  kind: 'rectangle',
  fill: [0.87, 0.93, 1, 1] as [number, number, number, number],
  stroke: Object.freeze({ color: 'ink' as const, width: 2 }),
  cornerRadius: 0,
  sides: 5,
});

/**
 * What the shape tool creates: a shape as the `createObject` input takes it, without the fields
 * the command fills in (stacking key, author and times); the id is given when a drag previewed
 * it, so the created object keeps the preview's.
 */
export type NewShapeObject = Omit<
  ShapeObject,
  'id' | 'z' | 'createdBy' | 'createdAt' | 'updatedAt'
> & {
  /** The id the drag's preview showed it under, if any. */
  readonly id?: ShapeObject['id'];
};

/** An axis-aligned box in world units, from its top-left corner. */
export interface ShapeBox {
  /** Left, world units. */
  readonly x: number;
  /** Top, world units. */
  readonly y: number;
  /** Width, world units. */
  readonly width: number;
  /** Height, world units. */
  readonly height: number;
}

/**
 * The shape a shape tool drag or click makes: the box, unturned, on the
 * board (not in a frame), in the tool's style, with no label (the first character typed into it
 * makes one). Pure: the style's colours are copied, so the object shares nothing with it.
 *
 * @param box - Where it goes, world units.
 * @param style - The tool's style.
 * @returns The object to create.
 */
export function newShapeObject(box: ShapeBox, style: NewShapeStyle): NewShapeObject {
  return {
    type: 'shape',
    parentId: null,
    x: box.x,
    y: box.y,
    rotation: 0,
    locked: false,
    width: box.width,
    height: box.height,
    kind: style.kind,
    fill: style.fill === null ? null : structuredClone(style.fill),
    stroke:
      style.stroke === null
        ? null
        : { color: copyInkableColor(style.stroke.color), width: style.stroke.width },
    cornerRadius: style.cornerRadius,
    sides: style.sides,
    label: null,
  };
}
