import type { StickyAspect, StyleRun, TextContent, TextObject } from '@canvas/schema';

import { fitNoteText, fittedNoteHeight } from '../box/note-fit.js';
import { shapeLabelWrapWidth, type ShapeLabelGeometry } from '../box/shape-label-box.js';
import { CONNECTOR_LABEL_WRAP_WIDTH, noteBoxHeight, noteWrapWidth } from '../box/text-boxes.js';
import type { FontMetrics } from '../font/font-metrics.js';
import type { GlyphMeasurer } from '../layout/glyph-measurer.js';

import { measureText, type TextBoxDirection, type TextMeasurement } from './measure-text.js';

/** The smallest width or height a text box is written with, world units (the app's minimum). */
export const MIN_TEXT_BOX_SIZE = 1;

/** The fields of a text object that measuring reads. */
export interface MeasurableTextObject extends Pick<TextObject, 'autoWidth'>, TextBoxDirection {
  /** The object type. */
  readonly type: 'text';
  /** The characters. */
  readonly text: string;
  /** Their style runs. */
  readonly runs: readonly StyleRun[];
  /** The box width, world units: where a fixed-width text wraps. */
  readonly width: number;
  /** The box height, world units. */
  readonly height: number;
}

/** The fields of a sticky note that measuring reads. */
export interface MeasurableNote extends TextBoxDirection {
  /** The object type. */
  readonly type: 'sticky';
  /** The characters. */
  readonly text: string;
  /** Their style runs. */
  readonly runs: readonly StyleRun[];
  /** The note's width, world units. */
  readonly width: number;
  /** The note's height, world units: it never shrinks below it. */
  readonly height: number;
  /** Its proportions: at least half as tall as wide when wide; square when absent. */
  readonly aspect?: StickyAspect | undefined;
}

/** The fields of a shape that measuring reads: its label and the box the label wraps in. */
export interface MeasurableShape extends ShapeLabelGeometry {
  /** The object type. */
  readonly type: 'shape';
  /** Its label, or `null` for none. */
  readonly label: TextContent | null;
}

/** The fields of a connector that measuring reads. */
export interface MeasurableConnector {
  /** The object type. */
  readonly type: 'connector';
  /** Its label, or `null` for none. */
  readonly label: TextContent | null;
}

/** An object with text that measuring reads. */
export type MeasurableObject =
  MeasurableTextObject | MeasurableNote | MeasurableShape | MeasurableConnector;

/** A text box's size, world units. */
export interface TextBoxSize {
  /** The width. */
  readonly width: number;
  /** The height. */
  readonly height: number;
}

/** An object's measured text, and for a text box the size the app writes it with. */
export interface ObjectTextMeasurement {
  /** The text's laid-out size, as the app wraps it in this object. */
  readonly text: TextMeasurement;
  /**
   * The box size the app writes a text object or sticky note with for this text; absent for a
   * label, which has no size of its own.
   */
  readonly box?: TextBoxSize;
  /**
   * A sticky note's drawn size, px of its largest run, once its text is fitted to it (
   * `fitNoteText`); absent for any other object.
   */
  readonly fittedFontSize?: number;
}

/**
 * Measures an object's text as the app lays it out, and the box it is sized to, as the text tool
 * writes it after an edit (`measuredSize` in `@canvas/tools`): an auto-width text as wide as its
 * longest line and a fixed-width one keeping its width, either as tall as its text; a sticky note
 * wrapping inside its padding, its text fitted to it (`fitNoteText`), keeping its width
 * and height and growing only when the text overflows at the fit's floor.
 * A shape's label wraps inside the box inscribed in the shape (`shapeLabelWrapWidth`), a
 * connector's at its label width. Pure.
 *
 * @param object - The text, note, shape or connector.
 * @param fonts - The faces' metrics (`measuringFontsFor`).
 * @param measurer - What measures the glyphs (`TextShaping.measurerFor`); by default
 *   the faces' per-codepoint metrics.
 * @returns The measurement, or `undefined` for a shape or connector without a label.
 */
export function measureObjectText(
  object: MeasurableObject,
  fonts: readonly FontMetrics[],
  measurer?: GlyphMeasurer,
): ObjectTextMeasurement | undefined {
  switch (object.type) {
    case 'text': {
      const text = measureText(
        object.text,
        object.runs,
        object.autoWidth ? null : object.width,
        fonts,
        measurer,
        boxDirectionOf(object),
      );
      const width = object.autoWidth ? text.width : object.width;
      return { text, box: boxOf(width, text.height) };
    }
    case 'sticky': {
      // Fitted to the note: the text as it is drawn, the note growing only when it
      // overflows at the floor.
      const fit = fitNoteText(
        { text: object.text, runs: object.runs, boxHeight: noteBoxHeight(object.height) },
        (runs) =>
          measureText(
            object.text,
            runs,
            noteWrapWidth(object.width),
            fonts,
            measurer,
            boxDirectionOf(object),
          ),
      );
      return {
        text: fit.layout,
        box: boxOf(object.width, fittedNoteHeight(object, fit)),
        fittedFontSize: fit.fittedFontSize,
      };
    }
    case 'shape':
    case 'connector': {
      if (object.label === null) return undefined;
      const wrapWidth =
        object.type === 'connector' ? CONNECTOR_LABEL_WRAP_WIDTH : shapeLabelWrapWidth(object);
      return {
        text: measureText(
          object.label.text,
          object.label.runs,
          wrapWidth,
          fonts,
          measurer,
          boxDirectionOf(object.label),
        ),
      };
    }
  }
}

/**
 * A text box's alignment, direction and paragraph styles, without the keys it leaves out.
 *
 * @param object - The text or note.
 * @returns Its alignment and direction.
 */
function boxDirectionOf(object: TextBoxDirection): TextBoxDirection {
  const { align, direction, paragraphs } = object;
  return {
    ...(align === undefined ? {} : { align }),
    ...(direction === undefined ? {} : { direction }),
    ...(paragraphs === undefined ? {} : { paragraphs }),
  };
}

/**
 * A box size no smaller than {@link MIN_TEXT_BOX_SIZE} either way.
 *
 * @param width - The width, world units.
 * @param height - The height, world units.
 * @returns The size.
 */
function boxOf(width: number, height: number): TextBoxSize {
  return {
    width: Math.max(MIN_TEXT_BOX_SIZE, width),
    height: Math.max(MIN_TEXT_BOX_SIZE, height),
  };
}
