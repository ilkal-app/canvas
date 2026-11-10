import type { ReactElement } from 'react';

import {
  DEFAULT_STROKE_ALIGN,
  INK,
  isTokenRef,
  STROKE_ALIGNS,
  type BoardObject,
  type InkableColor,
  type ObjectId,
  type Paint,
  type Rgba,
  type Stroke,
  type StrokeAlign,
} from '@canvas/schema';

import { DEFAULT_PEN_STROKE } from '../../tool-styles/pen-style.js';
import { ColourControl } from '../controls/colour-control.js';
import { commonValue, isSameColour, type Mixable } from '../controls/mixed-value.js';
import { NumberControl } from '../controls/number-control.js';
import { SelectControl, type SelectOption } from '../controls/select-control.js';
import { PaintControl, type PaintEdit } from '../paint/paint-control.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';

import { StrokeStyleControls } from './stroke-style-controls.js';

/** The stroke a shape gets when it had none: 1 world px of black. */
const DEFAULT_STROKE: Stroke = { color: [0, 0, 0, 1], width: 1 };

/** The thinnest stroke the field accepts, and its step, world px. */
const STROKE_WIDTH_STEP = 0.5;

/** The widest stroke (`MAX_STROKE_WIDTH` of the schema), world px. */
const MAX_STROKE_WIDTH = 64;

/** What each stroke alignment is called in the list. */
const ALIGN_LABELS: Readonly<Record<StrokeAlign, string>> = {
  inside: 'Inside',
  center: 'Center',
  outside: 'Outside',
};

/** The stroke alignments, in the list's order. */
const ALIGN_OPTIONS: readonly SelectOption[] = STROKE_ALIGNS.map((value) => ({
  value,
  label: ALIGN_LABELS[value],
}));

/** An object's fill and stroke, as far as it has them. */
interface FillStroke {
  readonly fill: Paint | null;
  readonly stroke: Stroke | null;
}

/**
 * The fill and stroke of a shape or path, and a frame's stroke (its fill is its
 * background, the frame section's); nothing for other types.
 *
 * @param object - The object.
 * @returns Its paint.
 */
function paintOf(object: BoardObject): FillStroke {
  if (object.type === 'shape' || object.type === 'path') {
    return { fill: object.fill, stroke: object.stroke };
  }
  if (object.type === 'frame') return { fill: null, stroke: object.stroke ?? null };
  return { fill: null, stroke: null };
}

/**
 * Where a stroked shape's or frame's outline lies, absent read as inside; nothing
 * for an object without a stroke, which has nothing to align.
 *
 * @param object - The object.
 * @returns Its alignment, or undefined.
 */
function strokeAlignOf(object: BoardObject): StrokeAlign | undefined {
  if (object.type !== 'shape' && object.type !== 'frame') return undefined;
  if (object.stroke === null || object.stroke === undefined) return undefined;
  return object.strokeAlign ?? DEFAULT_STROKE_ALIGN;
}

/**
 * The Align list of selected shapes and frames with a stroke: inside, center or
 * outside, Mixed when they differ; a choice sets `strokeAlign` alone, on the selected objects
 * with a stroke only (an unstroked one has nothing to align). Nothing while no selected object has a stroke, or for a creation tool's style (the tool
 * styles do not carry an alignment yet).
 *
 * @param props - The section's props.
 * @returns The control, or null.
 */
function AlignControl(props: StylePanelSectionProps): ReactElement | null {
  const aligns = props.selection.flatMap((object) => {
    const align = strokeAlignOf(object);
    return align === undefined ? [] : [align];
  });
  const value = commonValue(aligns, (align) => align);
  if (value === undefined) return null;
  return (
    <SelectControl
      label="Align"
      value={value}
      options={ALIGN_OPTIONS}
      onChange={(chosen) => {
        // Only the objects with a stroke take it: an unstroked one has nothing to align.
        const strokeAlign = chosen as StrokeAlign;
        props.applyStyle((object) =>
          object !== undefined && strokeAlignOf(object) !== undefined ? { strokeAlign } : {},
        );
      }}
    />
  );
}

/**
 * The creation tool's paint, from its style.
 *
 * @param props - The section's props.
 * @returns The tool's fill and stroke.
 */
function toolPaintOf(props: StylePanelSectionProps): FillStroke {
  return { fill: props.defaults?.fill ?? null, stroke: props.defaults?.stroke ?? null };
}

/**
 * A stroke colour chosen for an object, keeping the object's own alpha where it has a colour
 * tuple: a colour picked for a mixed selection sets the hue alone (the picker has no alpha); a
 * colour picked over `ink` is opaque, and over a colour token is set as chosen.
 *
 * @param colour - The colour chosen.
 * @param own - The object's stroke colour now.
 * @returns The colour to set.
 */
function withOwnStrokeAlpha(colour: Rgba, own: InkableColor): Rgba {
  return own === INK || isTokenRef(own) ? colour : [colour[0], colour[1], colour[2], own[3]];
}

/**
 * The width field of a path (the prototype's vector style group): 0 means no stroke, so
 * the field always shows; a width set on an unstroked path gives it the pen's default colour.
 *
 * @param props - The section's props.
 * @param paints - The selection's paints, or the tool's.
 * @param paintFor - An object's paint, or the tool's.
 * @returns The control.
 */
function PathWidthControl(
  props: StylePanelSectionProps,
  paints: readonly FillStroke[],
  paintFor: (object: BoardObject | undefined) => FillStroke,
): ReactElement {
  const width = commonValue(paints, (paint) => paint.stroke?.width ?? 0) ?? 0;
  return (
    <NumberControl
      label="Width"
      value={width}
      min={0}
      max={MAX_STROKE_WIDTH}
      step={1}
      onChange={(next) => {
        props.applyStyle((object) => {
          if (next === 0) return { stroke: null };
          const current = paintFor(object).stroke ?? DEFAULT_PEN_STROKE;
          return { stroke: { ...current, width: next } };
        });
      }}
    />
  );
}

/**
 * The objects an image fill may be chosen for: the selection when it is shapes only.
 * Paths, a mixed selection and the tools' styles (nothing selected) take no image fill.
 *
 * @param selection - The selected objects.
 * @returns Their ids, or undefined.
 */
function imageTargetsOf(selection: readonly BoardObject[]): readonly ObjectId[] | undefined {
  return selection.length > 0 && selection.every((object) => object.type === 'shape')
    ? selection.map((object) => object.id)
    : undefined;
}

/**
 * Enters crop mode on the one selected shape's image fill: only for one unlocked shape
 * (the paint control shows it while the fill is an image).
 *
 * @param props - The section's props.
 * @returns The handler, or undefined.
 */
function cropOf(props: StylePanelSectionProps): (() => void) | undefined {
  const [one, ...more] = props.selection;
  if (one?.type !== 'shape' || one.locked || more.length > 0) return undefined;
  return () => {
    props.dispatch({ type: 'selection', command: 'cropImageFill' });
  };
}

function FillStrokeControls(props: StylePanelSectionProps): ReactElement {
  const { applyStyle, selection } = props;
  const isPath = props.context === 'vector';
  // A frame's fill is its background, which the frame section edits.
  const hasFill = props.context !== 'frame';
  const paints = selection.length > 0 ? selection.map(paintOf) : [toolPaintOf(props)];
  const paintFor = (object: BoardObject | undefined) =>
    object === undefined ? toolPaintOf(props) : paintOf(object);
  const strokeColour: Mixable<InkableColor | null> =
    commonValue(paints, (paint) => paint.stroke?.color ?? null, isSameColour) ?? null;
  const widths = paints.flatMap((paint) => (paint.stroke === null ? [] : [paint.stroke.width]));
  const strokeWidth = commonValue(widths, (width) => width);
  const newStroke = isPath ? DEFAULT_PEN_STROKE : DEFAULT_STROKE;
  const editFill = (edit: PaintEdit) => {
    applyStyle((object) => {
      const own = paintFor(object).fill;
      const next = edit(own);
      return next === own ? {} : { fill: next };
    });
  };
  return (
    <>
      {hasFill && (
        <PaintControl
          label="Fill"
          paints={paints.map((paint) => paint.fill)}
          canBeNone
          onEdit={editFill}
          imageTargets={imageTargetsOf(selection)}
          onCrop={cropOf(props)}
        />
      )}
      <ColourControl
        label="Stroke"
        value={strokeColour}
        canBeNone
        onChange={(colour) => {
          applyStyle((object) => {
            if (colour === null) return { stroke: null };
            const current = paintFor(object).stroke ?? newStroke;
            return { stroke: { ...current, color: withOwnStrokeAlpha(colour, current.color) } };
          }, false);
        }}
        onInk={() => {
          applyStyle((object) => {
            const current = paintFor(object).stroke ?? newStroke;
            return current.color === INK ? {} : { stroke: { ...current, color: INK } };
          }, true);
        }}
        onToken={(token) => {
          applyStyle((object) => {
            const current = paintFor(object).stroke ?? newStroke;
            return { stroke: { ...current, color: token } };
          }, false);
        }}
      />
      {isPath && PathWidthControl(props, paints, paintFor)}
      {!isPath && strokeWidth !== undefined && (
        <NumberControl
          label="Width"
          value={strokeWidth}
          min={STROKE_WIDTH_STEP}
          max={MAX_STROKE_WIDTH}
          step={STROKE_WIDTH_STEP}
          onChange={(width) => {
            // Only the width changes: an object without a stroke keeps having none.
            applyStyle((object) => {
              const current = paintFor(object).stroke;
              return current === null ? {} : { stroke: { ...current, width } };
            });
          }}
        />
      )}
      {isPath && <StrokeStyleControls {...props} />}
      {!isPath && <AlignControl {...props} />}
    </>
  );
}

/**
 * Fill and stroke for shapes and paths, and the stroke of frames
 * (a frame's fill is its background, in the frame section): the fill colour or none
 * (a gradient, or for selected shapes an image), the stroke colour or none, the stroke
 * width while something has a stroke, and for selected shapes and frames with a stroke where it
 * lies about the edge (Align: inside, center, outside); both colours may name a board colour
 * token. A change sets that field alone on each object: a colour keeps each object's
 * alpha and stroke width, a width leaves unstroked objects unstroked. For paths (the vector
 * context, the prototype's
 * vector style group) the width always shows and 0 means no stroke; a stroke given to an
 * unstroked path starts from the pen's default (2 px near-black); selected paths also get the
 * dash, join and cap of their stroke (`StrokeStyleControls`). While the pen is active with
 * nothing selected it edits the pen tool's style, which new paths start in (a stroke of
 * [0.1, 0.1, 0.1, 1] at width 2 and no fill until changed). It is hidden while text is edited,
 * which shows the text context. This is the one home of the Fill and Stroke controls:
 * the vector, shape and line tools extend it (its `context`, and fields of their own) rather than
 * adding another fill or stroke control.
 */
export const stylePanelSection: StylePanelSection = {
  id: 'fill-stroke',
  title: 'Fill and stroke',
  // Frames have no Fill here (their fill is their background): "Stroke".
  titleFor: ({ context }) => (context === 'frame' ? 'Stroke' : 'Fill and stroke'),
  context: ['shape', 'vector', 'frame'],
  order: 7,
  render: FillStrokeControls,
};
