import type { StylePatch } from '@canvas/document';
import { colorSchema, inkableColorSchema, type Color, type InkableColor } from '@canvas/schema';
import { DEFAULT_SHAPE_STYLE } from '@canvas/tools';

import { storedField, type ToolPanelChoiceCodec } from '../tool-panel-choices.js';

/**
 * The kinds the Shapes panel offers, in its order. The design's block arrow is left out
 * of v1 (), so every kind is one the schema already has.
 */
export const SHAPE_PANEL_KINDS = ['rectangle', 'ellipse', 'triangle', 'polygon', 'star'] as const;

/** One of {@link SHAPE_PANEL_KINDS}. */
export type ShapePanelKind = (typeof SHAPE_PANEL_KINDS)[number];

/** What the Shapes panel holds: the next shape's kind, fill and stroke colour. */
export interface ShapesChoices {
  /** The kind the Shapes tool draws next. */
  readonly kind: ShapePanelKind;
  /** The fill colour, or `null` for none. */
  readonly fill: Color | null;
  /** The stroke colour (`ink` allowed), or `null` for none. */
  readonly stroke: InkableColor | null;
}

/** The stroke width a shape from the panel takes, world units: today's default. */
const SHAPE_STROKE_WIDTH = 2;

/** The sides a polygon or star from the panel has: the variants' (`POLYGON_VARIANT`). */
const SHAPE_SIDES = 5;

const isKind = (value: unknown): value is ShapePanelKind =>
  (SHAPE_PANEL_KINDS as readonly unknown[]).includes(value);
const isFill = (value: unknown): value is Color | null =>
  value === null || colorSchema.safeParse(value).success;
const isStroke = (value: unknown): value is InkableColor | null =>
  value === null || inkableColorSchema.safeParse(value).success;

/**
 * The Shapes panel's choices: their defaults are today's shape tool default (a pale blue
 * rectangle with an `ink` outline), and a stored field that is not valid takes its default.
 */
export const SHAPES_CHOICES: ToolPanelChoiceCodec<ShapesChoices> = {
  id: 'shapes',
  defaults: {
    kind: 'rectangle',
    fill: Array.isArray(DEFAULT_SHAPE_STYLE.fill) ? [...DEFAULT_SHAPE_STYLE.fill] : null,
    stroke: 'ink',
  },
  parse: (stored) => ({
    kind: storedField(stored, 'kind', isKind, SHAPES_CHOICES.defaults.kind),
    fill: storedField(stored, 'fill', isFill, SHAPES_CHOICES.defaults.fill),
    stroke: storedField(stored, 'stroke', isStroke, SHAPES_CHOICES.defaults.stroke),
  }),
};

/**
 * A copy of a colour, so a style never shares an array with the choices it came from.
 *
 * @param color - The colour.
 * @returns Its copy.
 */
function copyColor<T extends InkableColor>(color: T): T {
  return structuredClone(color);
}

/**
 * The shape tool's style the Shapes panel's choices give: the kind (a triangle is a
 * three-sided polygon, a polygon or star has five sides, as the tool variants do), the fill and
 * a 2-unit stroke, or none. Pure: it never changes the choices.
 *
 * @param choices - The panel's choices.
 * @returns The style the next shape takes.
 */
export function shapesToolStyle(choices: ShapesChoices): StylePatch {
  const { kind, fill, stroke } = choices;
  const shape: StylePatch =
    kind === 'triangle'
      ? { kind: 'polygon', sides: 3 }
      : kind === 'polygon' || kind === 'star'
        ? { kind, sides: SHAPE_SIDES }
        : { kind };
  return {
    ...shape,
    fill: fill === null ? null : copyColor(fill),
    stroke: stroke === null ? null : { color: copyColor(stroke), width: SHAPE_STROKE_WIDTH },
  };
}
