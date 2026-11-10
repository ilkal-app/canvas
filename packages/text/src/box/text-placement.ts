// Where each object's text box sits and how it is laid out: the per-type
// hook the engine's text pass draws by, the page's editor places its caret by, and the vector
// export places glyphs by. It lives here, beside the boxes' sizing rules, so a client
// without the engine places text as the engine does. Pure.
import type {
  BoardObject,
  ConnectorObject,
  ParagraphStyle,
  Point,
  ShapeObject,
  StickyObject,
  StyleRun,
  TextContent,
  TextObject,
  VERTICAL_ALIGNS,
} from '@canvas/schema';

import type { TextAlign, TextBaseDirection, TextLayout } from '../layout/text-layout.js';

import { labelPaddingOf, shapeLabelBox, shapeLabelWrapWidth } from './shape-label-box.js';
import {
  CONNECTOR_LABEL_WRAP_WIDTH,
  NOTE_PADDING,
  noteBoxHeight,
  noteWrapWidth,
} from './text-boxes.js';

/** Vertical placement of laid-out text in its box: the schema's `verticalAlign`. */
export type TextVerticalAlign = (typeof VERTICAL_ALIGNS)[number];

/**
 * Where a text box sits in its object and how it is laid out: the per-type hook of the text
 * pass. All lengths are world units in the object's own frame.
 */
export interface TextBoxGeometry {
  /** The characters. */
  readonly text: string;
  /** Their style runs. */
  readonly runs: readonly StyleRun[];
  /** The top-left corner of the box the text is laid out in, in the object's frame. */
  readonly origin: Point;
  /** The wrapping width; `null` for auto-width text, which wraps only at newlines. */
  readonly wrapWidth: number | null;
  /** Horizontal alignment of each line. */
  readonly align: TextAlign;
  /** The base direction of each paragraph: a text's or sticky's own, else auto. */
  readonly direction: TextBaseDirection;
  /** Where the laid-out text sits in the box's height. */
  readonly verticalAlign: TextVerticalAlign;
  /** The box's height, for vertical alignment. */
  readonly boxHeight: number;
  /**
   * Whether text taller than the box keeps its vertical alignment, overflowing the box (a
   * shape's label, centred: as much above as below), rather than starting at the box's
   * top and running on below it (a sticky note's, a text object's). Default false.
   */
  readonly isOverflowAligned?: boolean;
  /**
   * A sticky note's text box height its text is fitted to (`fitNoteText`): the engine's
   * layout job lays the text out at the largest size that fits it. Absent for any other box.
   */
  readonly fitHeight?: number;
  /**
   * The most lines each paragraph shows (a link card's title and description,
   * `clampLines`); a longer one ends with an ellipsis. Absent: every line.
   */
  readonly lineCaps?: readonly number[];
  /** One style per paragraph when any is a list: lists indent and get markers. */
  readonly paragraphs?: readonly ParagraphStyle[];
}

/**
 * A content's paragraph styles as a geometry field: present when any paragraph is a
 * list, so plain text keys and lays out as it did.
 *
 * @param content - The content.
 * @param content.paragraphs - Its paragraph styles, if any.
 * @returns The field, or nothing.
 */
function paragraphsOf(content: { readonly paragraphs?: readonly ParagraphStyle[] | undefined }): {
  readonly paragraphs?: readonly ParagraphStyle[];
} {
  const { paragraphs } = content;
  return paragraphs?.some((style) => style.list !== undefined) === true ? { paragraphs } : {};
}

/**
 * The point halfway along a placed connector's route, in its frame, where its label is centred:
 * the engine's connector geometry (`connectorShapeOf`), which this package does not hold.
 *
 * @param connector - The connector.
 * @returns The point, world units in the connector's frame.
 */
export type ConnectorLabelPointOf = (connector: ConnectorObject) => Point;

/**
 * The text box of a sticky note: inside the padding,
 * wrapping at {@link noteWrapWidth}, with the note's own alignment. The box is the padded
 * height, so text shorter than the note sits where its `verticalAlign` puts it (a note is made
 * centred, `middle`, by the sticky tool), and text as tall as the box starts at the top padding.
 * Pure.
 *
 * @param note - The sticky.
 * @returns Its text box, in the note's frame.
 */
export function noteTextPlacement(note: StickyObject): TextBoxGeometry {
  return {
    text: note.text,
    runs: note.runs,
    origin: { x: NOTE_PADDING, y: NOTE_PADDING },
    wrapWidth: noteWrapWidth(note.width),
    align: note.align,
    direction: note.direction ?? 'auto',
    verticalAlign: note.verticalAlign,
    boxHeight: noteBoxHeight(note.height),
    fitHeight: noteBoxHeight(note.height),
    ...paragraphsOf(note),
  };
}

/**
 * The text box of a shape's label: inside the kind's inscribed box
 * ({@link shapeLabelBox}) less its padding ({@link labelPaddingOf}), wrapping at its width (never
 * below one world unit), each line centred and the text centred in its height. Text taller than
 * the box stays centred on it and overflows it equally above and below (`isOverflowAligned`,
 * {@link textOriginOf}): the label is not clipped and the shape does not grow (the owner's
 * ruling); the editor takes presses on the overflowing lines too. A shape without a
 * label places empty text, so the editor can start one. Pure.
 *
 * @param shape - The shape.
 * @returns Its label's text box, in the shape's frame.
 */
export function shapeLabelPlacement(shape: ShapeObject): TextBoxGeometry {
  const box = shapeLabelBox(shape);
  const padding = labelPaddingOf(box);
  return {
    text: shape.label?.text ?? '',
    runs: shape.label?.runs ?? [],
    origin: { x: box.x + padding, y: box.y + padding },
    wrapWidth: shapeLabelWrapWidth(shape),
    align: 'center',
    direction: 'auto',
    verticalAlign: 'middle',
    boxHeight: Math.max(0, box.height - 2 * padding),
    isOverflowAligned: true,
    ...paragraphsOf(shape.label ?? {}),
  };
}

/**
 * The text box of a connector's label ("text drawn at the middle of the
 * route"): centred on the point halfway along its route, each line centred, wrapping at
 * {@link CONNECTOR_LABEL_WRAP_WIDTH}, and as much above the point as below it, whatever its
 * height. The box has no height, so the text overflows it centred, as a shape's label does. Pure.
 *
 * @param point - The point halfway along the route, in the connector's frame.
 * @param content - The label.
 * @returns The box, in the connector's frame.
 */
export function connectorLabelPlacementAt(point: Point, content: TextContent): TextBoxGeometry {
  return {
    text: content.text,
    runs: content.runs,
    origin: { x: point.x - CONNECTOR_LABEL_WRAP_WIDTH / 2, y: point.y },
    wrapWidth: CONNECTOR_LABEL_WRAP_WIDTH,
    align: 'center',
    direction: 'auto',
    verticalAlign: 'middle',
    boxHeight: 0,
    isOverflowAligned: true,
    ...paragraphsOf(content),
  };
}

/**
 * The text box an object draws, if any: a text object's body, laid out in its whole box from
 * its local origin, wrapping at its width unless it is auto-width; a sticky note's text inside
 * its padding ({@link noteTextPlacement}); a shape's label centred in the box inscribed
 * in its kind ({@link shapeLabelPlacement}), when it has one; a connector's label centred
 * halfway along its route ({@link connectorLabelPlacementAt}), when it has one and the
 * caller can find that point. Other types draw no text yet. Pure.
 *
 * @param object - The object.
 * @param labelPointOf - Where a connector's label is centred; without it a connector places none.
 * @returns The box, or `undefined` when the object draws no text; a text object's or a sticky
 *   note's always exists.
 */
export function textPlacementOf(
  object: TextObject | StickyObject,
  labelPointOf?: ConnectorLabelPointOf,
): TextBoxGeometry;
export function textPlacementOf(
  object: BoardObject,
  labelPointOf?: ConnectorLabelPointOf,
): TextBoxGeometry | undefined;
export function textPlacementOf(
  object: BoardObject,
  labelPointOf?: ConnectorLabelPointOf,
): TextBoxGeometry | undefined {
  if (object.type === 'sticky') return noteTextPlacement(object);
  if (object.type === 'shape') {
    return object.label === null ? undefined : shapeLabelPlacement(object);
  }
  if (object.type === 'connector') {
    if (object.label === null || labelPointOf === undefined) return undefined;
    return connectorLabelPlacementAt(labelPointOf(object), object.label);
  }
  if (object.type !== 'text') return undefined;
  return {
    text: object.text,
    runs: object.runs,
    origin: { x: 0, y: 0 },
    wrapWidth: object.autoWidth ? null : object.width,
    align: object.align,
    direction: object.direction ?? 'auto',
    verticalAlign: object.verticalAlign,
    boxHeight: object.height,
    ...paragraphsOf(object),
  };
}

/** Vertical offsets of the laid-out text in its box, by `verticalAlign`, as box fractions. */
const VERTICAL_FRACTION = { top: 0, middle: 0.5, bottom: 1 } as const;

/**
 * Where a box's laid-out text starts, in the object's frame: its origin, moved down by the
 * vertical alignment when the box is taller than the text (a sticky note's short text centred).
 * Text taller than the box starts at its top, unless the box keeps the alignment
 * (`isOverflowAligned`: a shape's label stays centred, its origin above the box's). The engine's
 * text pass and the page's text editor both place text by it, so the caret sits on the glyphs.
 * Pure.
 *
 * @param geometry - The box.
 * @param layout - Its layout; only the height is read.
 * @returns The placement's origin, world units.
 */
export function textOriginOf(geometry: TextBoxGeometry, layout: Pick<TextLayout, 'height'>): Point {
  const spare = geometry.boxHeight - layout.height;
  const room = geometry.isOverflowAligned === true ? spare : Math.max(0, spare);
  return {
    x: geometry.origin.x,
    y: geometry.origin.y + room * VERTICAL_FRACTION[geometry.verticalAlign],
  };
}
