import { z } from 'zod';

import {
  fontVariationAxesSchema,
  fontFeaturesSchema,
  fontVariationsSchema,
  colorModeSchema,
  connectorObjectSchema,
  frameCornerRadiusSchema,
  frameObjectSchema,
  freehandObjectSchema,
  imageObjectSchema,
  languageTagSchema,
  postScriptNameSchema,
  shapeObjectSchema,
  linkSchema,
  stickyAspectSchema,
  stickyObjectSchema,
  strokeAlignSchema,
  strokeSchema,
  type Stroke,
  textObjectSchema,
  styleIdSchema,
  textStyleSchema,
  visibilityShape,
  type ObjectType,
} from '@canvas/schema';

/**
 * A style's `stroke.align` as its own `strokeAlign` field: agents give the alignment
 * inside the stroke, where the board keeps it beside it. Anything else, and a stroke whose
 * `align` differs from a `strokeAlign` given beside it, is returned as it is.
 *
 * @param style - Style fields, as `style` or an `apply` step takes them.
 * @returns The fields with the alignment lifted out of the stroke.
 */
export function liftStrokeAlign(
  style: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const { stroke } = style;
  if (typeof stroke !== 'object' || stroke === null || !('align' in stroke)) return style;
  const { align, ...plain } = stroke as Readonly<Record<string, unknown>>;
  if (align === undefined) return { ...style, stroke: plain };
  // Two alignments that differ are left as given, for the style patch to refuse.
  if (style.strokeAlign !== undefined && style.strokeAlign !== align) return style;
  return { ...style, stroke: plain, strokeAlign: align };
}

/**
 * Validates a style patch: the appearance fields of every object type, each optional, plus
 * `textStyle`, the text style fields to set on all of an object's text. The field schemas are
 * the object schemas' own, so descriptions and limits match. Which fields an object takes
 * depends on its type ({@link STYLE_FIELDS_BY_TYPE}); `route` accepts every connector route, and
 * the merged object is validated against its type afterwards (a line has no curved route).
 */
export const stylePatchSchema = z
  .strictObject({
    /** Shapes: which primitive. */
    kind: shapeObjectSchema.shape.kind.optional(),
    /** Freehand strokes: the look, pencil, marker or highlighter. */
    tool: freehandObjectSchema.shape.tool
      .optional()
      .describe('Freehand strokes: the look, pencil, marker or highlighter.'),
    /**
     * Shapes, lines, connectors, paths and frames: the outline, or null for none
     * (shapes, paths and frames).
     */
    stroke: strokeSchema
      .extend({
        /** Shapes and frames: read as `strokeAlign`, where agents first write it. */
        align: strokeAlignSchema.optional().describe('Shapes and frames: read as strokeAlign.'),
      })
      .nullable()
      .optional()
      .describe(
        'The outline { color, width, align? } (color an RGBA tuple or "ink"), or null for none on shapes, paths and frames.',
      ),
    /**
     * Shapes and frames: where the outline lies about the edge, inside (the
     * default), center or outside.
     */
    strokeAlign: shapeObjectSchema.shape.strokeAlign.describe(
      'Shapes and frames: where the outline lies about the edge: inside (the default), center (straddling it, as SVG) or outside.',
    ),
    /** Shapes and paths: the fill colour, or null for none. */
    fill: shapeObjectSchema.shape.fill.optional(),
    /**
     * Shapes and frames: corner rounding, world units. A shape takes one number; a frame one
     * number or four, `[topLeft, topRight, bottomRight, bottomLeft]`, and an explicit
     * `undefined` removes a frame's (sharp again).
     */
    cornerRadius: frameCornerRadiusSchema
      .optional()
      .describe(
        'Shapes and frames: corner rounding in world px. A shape takes one number; a frame one number or four, [topLeft, topRight, bottomRight, bottomLeft].',
      ),
    /** Shapes: sides of a polygon or points of a star. */
    sides: shapeObjectSchema.shape.sides.optional(),
    /** Stickies: the note colour. */
    color: stickyObjectSchema.shape.color.optional(),
    /**
     * Every layer: opacity from 0 to 1, multiplied into everything a group, frame, main
     * or instance holds; an explicit `undefined` removes it (opaque again), except an image's.
     */
    opacity: imageObjectSchema.shape.opacity
      .optional()
      .describe(
        "Opacity from 0 (invisible) to 1 (opaque) on any layer but comments and videos; a group's, frame's, main's or instance's multiplies into its content.",
      ),
    /**
     * Every layer but a comment: hidden, it and everything inside it is not drawn, not
     * hit and takes no space in an auto-layout; false shows it, an explicit `undefined` removes it.
     */
    isHidden: visibilityShape.isHidden,
    /**
     * Images: the part of the source image shown, fractions of its natural size; the box follows
     * it (`croppedImageBox`), so what stays shown does not move.
     */
    crop: imageObjectSchema.shape.crop.optional(),
    /** Lines and connectors: the decoration at the start. */
    startCap: connectorObjectSchema.shape.startCap.optional(),
    /** Lines and connectors: the decoration at the end. */
    endCap: connectorObjectSchema.shape.endCap.optional(),
    /**
     * Paths, lines and connectors: the dash pattern, or null for solid. An absent
     * dash is solid too.
     */
    strokeDash: connectorObjectSchema.shape.strokeDash,
    /** Paths, lines and connectors: how the stroke turns corners. */
    strokeJoin: connectorObjectSchema.shape.strokeJoin,
    /** Paths, lines and connectors: the miter limit of miter joins. */
    strokeMiterLimit: connectorObjectSchema.shape.strokeMiterLimit,
    /**
     * Paths, lines and connectors: how open ends and dashes end; on a line or
     * connector, an end with a decoration keeps the decoration's shaft end.
     */
    strokeCap: connectorObjectSchema.shape.strokeCap,
    /** Lines (straight, elbow) and connectors (also curved): the routing. */
    route: connectorObjectSchema.shape.route.optional(),
    /** Frames: the fill behind the children, or null. */
    background: frameObjectSchema.shape.background.optional(),
    /** Frames: whether children are clipped to the frame. */
    clip: frameObjectSchema.shape.clip.optional(),
    /**
     * Frames: whether the name is drawn above the frame; once set it stays explicit,
     * where an unset frame hides its name inside a frame or component and shows it otherwise.
     */
    showName: frameObjectSchema.shape.showName.describe(
      'Frames: whether the name is drawn above the frame. A frame never given one hides its name inside another frame or a component and shows it otherwise.',
    ),
    /**
     * Frames, mains and instances: the colour mode of their content, or `null` to
     * inherit it again from the enclosing frame, main or instance, else the viewer's theme.
     */
    colorMode: colorModeSchema
      .nullable()
      .optional()
      .describe(
        "Frames, mains and instances: the colour mode their content draws tokens in, 'light' or 'dark'; null to inherit.",
      ),
    /**
     * Shapes and frames: a drop shadow under the object, or null to remove it: its
     * silhouette moved by `x` and `y`, grown by `spread` and blurred by `blur` (world px).
     */
    shadow: shapeObjectSchema.shape.shadow.describe(
      'Shapes and frames: a drop shadow { x, y, blur, spread, color } in world px (blur as in Figma or CSS), a list of 1 to 8 drawn in order (the first lowest), or null to remove it.',
    ),
    /**
     * Shapes and frames: the board effect style to apply, its layers written to
     * `shadow`; `null` to detach the object from its style, keeping its shadow.
     */
    effectStyleId: styleIdSchema
      .nullable()
      .optional()
      .describe(
        "Shapes and frames: a board effect style's id, whose shadow layers it takes; null to detach it, keeping its shadow.",
      ),
    /** Texts and stickies: horizontal alignment. */
    align: textObjectSchema.shape.align.optional(),
    /** Texts and stickies: each paragraph's base direction. */
    direction: textObjectSchema.shape.direction,
    /** Stickies: square or wide; absent is square. */
    aspect: stickyAspectSchema,
    /** Texts, stickies and images: the link ⌘-click opens; absent is none. */
    link: linkSchema.optional(),
    /** Images: a stroke drawn inside the edge, or null for none. */
    border: strokeSchema
      .nullable()
      .optional()
      .describe(
        'Images: a stroke inside the edge { color, width } (color an RGBA tuple, "ink" or a token), or null for none.',
      ),
    /**
     * Connectors: where the label sits along the route, 0 (from) to 1 (to), as a person drags it;
     * absent is the midpoint.
     */
    labelPosition: connectorObjectSchema.shape.labelPosition,
    /**
     * Connectors: where an elbow route's middle piece runs between its ends' stubs, 0 to 1, as a
     * person drags its handle (an L's arm into the end too); absent is the automatic route.
     */
    elbowMiddle: connectorObjectSchema.shape.elbowMiddle,
    /**
     * Connectors: the point a curved route passes through halfway, relative to the line between
     * its ends, as a person drags its bend handle; absent is the automatic curve.
     */
    curvePoint: connectorObjectSchema.shape.curvePoint,
    /** Texts and stickies: vertical alignment. */
    verticalAlign: textObjectSchema.shape.verticalAlign.optional(),
    /** Texts: whether the box grows with its longest line. */
    autoWidth: textObjectSchema.shape.autoWidth.optional(),
    /** Text style fields to set on every character of the object's text or label. */
    textStyle: textStyleSchema
      .partial()
      .extend({
        /** Variable-font coordinates; `null` or empty removes them. */
        fontVariations: fontVariationsSchema.nullable().optional(),
        /** OpenType features; `null` or empty removes them. */
        fontFeatures: fontFeaturesSchema.nullable().optional(),
        /** Some axes merged into each run's coordinates; `null` removes one. */
        fontVariationsAxes: fontVariationAxesSchema.optional(),
        /**
         * A board text style to apply: its values fill the fields not given; `null`
         * detaches the text from its style, keeping its values.
         */
        textStyleId: styleIdSchema
          .nullable()
          .optional()
          .describe(
            "A board text style's id, whose values fill the fields not given; null to detach the text, keeping its values.",
          ),
        /** The text's language, a BCP 47 tag; `null` removes it. */
        lang: languageTagSchema
          .nullable()
          .optional()
          .describe("The text's language, a BCP 47 tag such as ja or zh-Hant; null removes it."),
        /** The face's PostScript name; `null` removes it, and a family change clears it. */
        postScriptName: postScriptNameSchema.nullable().optional(),
        /**
         * A link on every character, under's rules; `null` removes every run's
         * link. Absent keeps each run's own.
         */
        link: linkSchema
          .nullable()
          .optional()
          .describe(
            "A link on every character of the text (http, https or mailto); null removes every run's link.",
          ),
      })
      .optional()
      .describe("Text style fields to set on every character of the object's text or label."),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'set at least one style field' })
  .refine(
    ({ stroke, strokeAlign }) =>
      stroke?.align === undefined || strokeAlign === undefined || stroke.align === strokeAlign,
    { message: 'stroke.align and strokeAlign differ; give one', path: ['strokeAlign'] },
  )
  // The board keeps the alignment beside the stroke (`liftStrokeAlign`).
  .transform(
    ({
      stroke,
      ...rest
    }): typeof rest & {
      /** Shapes, lines, connectors, paths and frames: the outline, or null for none. */
      stroke?: Stroke | null;
    } => {
      if (stroke === undefined) return rest;
      if (stroke === null) return { ...rest, stroke };
      const { align, ...plain } = stroke;
      if (align === undefined) return { ...rest, stroke: plain };
      return { ...rest, stroke: plain, strokeAlign: rest.strokeAlign ?? align };
    },
  )
  .describe('Appearance fields to set; each object type takes only its own.');

/** A style patch, as `setStyle` takes it. */
export type StylePatch = z.output<typeof stylePatchSchema>;

/** The name of a style patch field. */
export type StyleFieldName = keyof StylePatch;

/** The stroke style fields of paths, lines and connectors. */
export const STROKE_STYLE_FIELDS = [
  'strokeDash',
  'strokeJoin',
  'strokeMiterLimit',
  'strokeCap',
] as const satisfies readonly StyleFieldName[];

/**
 * The style fields each object type takes. `textStyle` restyles a text or sticky body, or a
 * shape or connector label (which must exist). Every layer takes `opacity` but a video,
 * and every layer `isHidden` but a comment, which has no appearance fields: `setStyle`
 * refuses it.
 */
export const STYLE_FIELDS_BY_TYPE: Readonly<Record<ObjectType, readonly StyleFieldName[]>> = {
  text: [
    'align',
    'direction',
    'verticalAlign',
    'autoWidth',
    'textStyle',
    'opacity',
    'isHidden',
    'link',
  ],
  sticky: [
    'align',
    'direction',
    'verticalAlign',
    'color',
    'aspect',
    'textStyle',
    'opacity',
    'isHidden',
    'link',
  ],
  image: ['opacity', 'crop', 'isHidden', 'link', 'border'],
  video: ['isHidden'],
  shape: [
    'kind',
    'stroke',
    'strokeAlign',
    'fill',
    'cornerRadius',
    'sides',
    'shadow',
    'effectStyleId',
    'textStyle',
    'opacity',
    'isHidden',
  ],
  line: ['stroke', ...STROKE_STYLE_FIELDS, 'startCap', 'endCap', 'route', 'opacity', 'isHidden'],
  connector: [
    'stroke',
    ...STROKE_STYLE_FIELDS,
    'startCap',
    'endCap',
    'route',
    'textStyle',
    'labelPosition',
    'elbowMiddle',
    'curvePoint',
    'opacity',
    'isHidden',
  ],
  path: ['stroke', ...STROKE_STYLE_FIELDS, 'fill', 'opacity', 'isHidden'],
  freehand: ['tool', 'stroke', 'opacity', 'isHidden'],
  group: ['opacity', 'isHidden'],
  frame: [
    'background',
    'stroke',
    'strokeAlign',
    'cornerRadius',
    'clip',
    'showName',
    'colorMode',
    'shadow',
    'effectStyleId',
    'opacity',
    'isHidden',
  ],
  comment: [],
  component: ['colorMode', 'opacity', 'isHidden'],
  instance: ['colorMode', 'opacity', 'isHidden'],
  link: ['opacity', 'isHidden'],
};

/** An object type with its optional fields' `undefined` removed, as `exactOptionalPropertyTypes` wants. */
export type DefinedFields<Value> = { [Key in keyof Value]?: Exclude<Value[Key], undefined> };

/**
 * Copies an object without its `undefined` fields. Zod leaves absent optional keys out, but its
 * types still admit `undefined`; the store's patch types do not.
 *
 * @param value - The object.
 * @returns A new object holding only the defined fields.
 */
export function definedFields<Value extends object>(value: Value): DefinedFields<Value> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as DefinedFields<Value>;
}
