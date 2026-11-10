import type { ReactElement } from 'react';

import { MAX_STROKE_WIDTH, type InkableColor, type Stroke } from '@canvas/schema';

import { CompactDropdown } from '../controls/compact-dropdown.js';
import { CustomNumberFooter } from '../controls/custom-number-footer.js';
import { MIXED, type Mixable } from '../panels/controls/mixed-value.js';
import { commonValue } from '../panels/controls/mixed-value.js';
import type { StyleChange } from '../state/shell-action.js';

import type { PopoverStyleControlsProps } from './popover-controls.js';
import { PopoverLinkButton, runLinkEntriesOf } from './popover-link.js';
import { Divider } from './popover-row-parts.js';
import { PopoverColourButton, TypeControls } from './popover-shared.js';
import { popoverTextValues } from './popover-values.js';
import {
  kindStyleOf,
  POPOVER_STROKE_WIDTHS,
  shapeKindOf,
  sharedFillOf,
  sharedStrokeColourOf,
  sharedStrokeWidthOf,
  type PopoverLine,
  type PopoverShape,
} from './shape-connector-values.js';
import { ShapeKindDropdown } from './shape-kind-dropdown.js';

/** The width a stroke starts at when a shape without one is given a colour, px. */
const NEW_STROKE_WIDTH = 2;

/**
 * A stroke width dropdown: 1, 2, 4 and 8 px, "Mixed" where the objects differ, and a
 * Custom field for any whole width from 1 to `MAX_STROKE_WIDTH` px (item 14).
 *
 * @param props - Its name, the width and the handler.
 * @param props.label - Its name ("Stroke width", "Line width").
 * @param props.width - The width the objects share, or mixed (also where some have no stroke).
 * @param props.onChange - Receives a width chosen.
 * @returns The dropdown.
 */
export function StrokeWidthDropdown(props: {
  readonly label: string;
  readonly width: Mixable<number>;
  readonly onChange: (width: number) => void;
}): ReactElement {
  const { width } = props;
  const shown = width === MIXED ? '' : String(width);
  const options = POPOVER_STROKE_WIDTHS.map((value) => ({
    value: String(value),
    label: `${String(value)} px`,
  }));
  const isOther = shown !== '' && !options.some((option) => option.value === shown);
  return (
    <CompactDropdown
      label={props.label}
      value={shown}
      options={
        isOther ? [...options, { value: shown, label: `${shown} px`, isHidden: true }] : options
      }
      isMixed={width === MIXED}
      width={58}
      onChange={(value) => {
        props.onChange(Number(value));
      }}
      // A typed whole width too, up to the widest stroke drawn (item 14).
      footer={(close) => (
        <CustomNumberFooter
          value={width}
          min={1}
          max={MAX_STROKE_WIDTH}
          fieldLabel="Custom stroke width"
          groupLabel="Custom width"
          onCommit={props.onChange}
          close={close}
        />
      )}
    />
  );
}

/**
 * The changes that give each object a stroke colour, or none: a shape without a stroke takes a
 * 2 px one; none removes a shape's stroke (a line always has one).
 *
 * @param objects - The shapes or lines.
 * @param color - The colour, or null for none.
 * @returns One change per object.
 */
export function strokeColourChanges(
  objects: readonly (PopoverShape | PopoverLine)[],
  color: InkableColor | null,
): StyleChange[] {
  return objects.map((object) => {
    const stroke: Stroke | null =
      color === null ? null : { ...(object.stroke ?? { width: NEW_STROKE_WIDTH }), color };
    return { id: object.id, style: { stroke } };
  });
}

/**
 * The changes that set each stroked object's width; an object without a stroke is left alone.
 *
 * @param objects - The shapes or lines.
 * @param width - The width, px.
 * @returns One change per stroked object.
 */
export function strokeWidthChanges(
  objects: readonly (PopoverShape | PopoverLine)[],
  width: number,
): StyleChange[] {
  return objects.flatMap((object) =>
    object.stroke === null
      ? []
      : [{ id: object.id, style: { stroke: { ...object.stroke, width } } }],
  );
}

/**
 * The shape row (the SHAPE card): fill, stroke colour, stroke width and the kind's
 * swap; then, when every shape has a label, its font and size. Each choice is one change of
 * every selected shape, one undo step.
 *
 * @param props - The popover's controls' props, the selection all shapes.
 * @param props.controls - The popover's controls' props.
 * @param props.shapes - The selected shapes.
 * @returns The controls.
 */
export function ShapeControls(props: {
  readonly controls: PopoverStyleControlsProps;
  readonly shapes: readonly PopoverShape[];
}): ReactElement {
  const { controls, shapes } = props;
  const restyle = (changes: StyleChange[]): void => {
    if (changes.length > 0) controls.dispatch({ type: 'style', changes });
  };
  const isLabelled = shapes.every((shape) => shape.label !== null);
  return (
    <>
      <PopoverColourButton
        kind="fill"
        value={sharedFillOf(shapes)}
        controls={controls}
        onChange={(fill) => {
          // The fill palette offers no ink (a fill takes a colour, a token or none).
          if (fill === 'ink') return;
          restyle(shapes.map((shape) => ({ id: shape.id, style: { fill } })));
        }}
      />
      <PopoverColourButton
        kind="stroke"
        value={sharedStrokeColourOf(shapes)}
        controls={controls}
        onChange={(color) => {
          restyle(strokeColourChanges(shapes, color));
        }}
      />
      <StrokeWidthDropdown
        label="Stroke width"
        width={sharedStrokeWidthOf(shapes)}
        onChange={(width) => {
          restyle(strokeWidthChanges(shapes, width));
        }}
      />
      <ShapeKindDropdown
        kind={commonValue(shapes, shapeKindOf) ?? MIXED}
        onChange={(kind) => {
          restyle(shapes.map((shape) => ({ id: shape.id, style: kindStyleOf(kind, shape) })));
        }}
      />
      <Divider />
      {isLabelled ? (
        <TypeControls controls={controls} values={popoverTextValues(shapes, controls.textStyle)} />
      ) : null}
      {/* A label's links: listed only when it carries some. */}
      {runLinkEntriesOf(shapes).length > 0 ? (
        <PopoverLinkButton selection={shapes} dispatch={controls.dispatch} isListOnly />
      ) : null}
    </>
  );
}
