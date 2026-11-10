import type { ReactElement } from 'react';

import { MAX_SHAPE_SIDES, SHAPE_KINDS, type BoardObject, type ShapeObject } from '@canvas/schema';
import { DEFAULT_SHAPE_STYLE } from '@canvas/tools';

import { SHAPE_KIND_LABELS } from '../../state/tool-variants.js';
import { commonValue, MIXED } from '../controls/mixed-value.js';
import { NumberControl } from '../controls/number-control.js';
import { SelectControl, type SelectOption } from '../controls/select-control.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';

const KIND_OPTIONS: readonly SelectOption[] = SHAPE_KINDS.map((kind) => ({
  value: kind,
  label: SHAPE_KIND_LABELS[kind],
}));

/** The largest corner radius the field offers, world units (the shader clamps to the shape). */
const MAX_CORNER_RADIUS = 1000;

/** The fewest sides of a polygon or points of a star (the schema's minimum). */
const MIN_SIDES = 3;

/** The shape fields the section edits, of one shape or of the shape tool's style. */
type ShapeFields = Pick<ShapeObject, 'kind' | 'cornerRadius' | 'sides'>;

/**
 * A shape's fields; the shape tool's style (its defaults under what is set) for none.
 *
 * @param object - The object, or undefined for the tool's style.
 * @param props - The panel's props, for the tool's style.
 * @returns The fields, or undefined for an object that is not a shape.
 */
function fieldsOf(
  object: BoardObject | undefined,
  props: StylePanelSectionProps,
): ShapeFields | undefined {
  if (object?.type === 'shape') return object;
  if (object !== undefined) return undefined;
  const { defaults } = props;
  return {
    kind: defaults?.kind ?? DEFAULT_SHAPE_STYLE.kind,
    // A shape's radius is one number; a frame's four are never a shape tool's.
    cornerRadius:
      typeof defaults?.cornerRadius === 'number'
        ? defaults.cornerRadius
        : DEFAULT_SHAPE_STYLE.cornerRadius,
    sides: defaults?.sides ?? DEFAULT_SHAPE_STYLE.sides,
  };
}

/**
 * Whether a kind is drawn with a number of sides or points.
 *
 * @param kind - The kind.
 * @returns True for a polygon or a star.
 */
function hasSides(kind: ShapeObject['kind']): boolean {
  return kind === 'polygon' || kind === 'star';
}

/**
 * The style panel's shape section: the kind, a rectangle's corner radius (a rounded
 * rectangle) and a polygon's sides or a star's points, for the selected shapes or, with the shape
 * tool active and nothing selected, for the tool's style. Fill and stroke are the fill and stroke
 * section's. A kind picked for selected shapes also becomes the shape tool's, so the last kind
 * picked is the next shape's; a radius or a count applies to the shapes of the kinds that have one.
 * Each committed choice is one `setStyle`, one undo step; a mixed selection shows "Mixed" and a
 * choice sets that field alone. None of these fields writes a size, so a locked shape is restyled
 * too.
 *
 * @param props - The panel's props.
 * @returns The controls.
 */
export function ShapeControls(props: StylePanelSectionProps): ReactElement {
  const { selection, applyStyle, dispatch } = props;
  const targets = selection.length > 0 ? selection : [undefined];
  const fields = targets.flatMap((object) => fieldsOf(object, props) ?? []);
  const kind = commonValue(fields, (shape) => shape.kind) ?? MIXED;
  const rounded = fields.filter((shape) => shape.kind === 'rectangle');
  const sided = fields.filter((shape) => hasSides(shape.kind));
  const cornerRadius = commonValue(rounded, (shape) => shape.cornerRadius) ?? MIXED;
  const sides = commonValue(sided, (shape) => shape.sides) ?? MIXED;
  const isAllStars = sided.every((shape) => shape.kind === 'star');
  const kindOf = (object: BoardObject | undefined) => fieldsOf(object, props)?.kind;
  return (
    <>
      <SelectControl
        label="Kind"
        value={kind}
        options={KIND_OPTIONS}
        onChange={(chosen) => {
          const style = { kind: chosen as ShapeObject['kind'] };
          applyStyle(style);
          if (selection.length > 0) dispatch({ type: 'setToolStyle', tool: 'shape', style });
        }}
      />
      {rounded.length > 0 && (
        <NumberControl
          label="Corner radius"
          value={cornerRadius}
          min={0}
          max={MAX_CORNER_RADIUS}
          onChange={(chosen) => {
            applyStyle((object) =>
              kindOf(object) === 'rectangle' ? { cornerRadius: chosen } : {},
            );
          }}
        />
      )}
      {sided.length > 0 && (
        <NumberControl
          label={isAllStars ? 'Points' : 'Sides'}
          value={sides}
          min={MIN_SIDES}
          max={MAX_SHAPE_SIDES}
          onChange={(chosen) => {
            const count = Math.round(chosen);
            applyStyle((object) => {
              const own = kindOf(object);
              return own !== undefined && hasSides(own) ? { sides: count } : {};
            });
          }}
        />
      )}
    </>
  );
}

/**
 * The shape section: shown for shapes and the shape tool's style (the `shape` context), first
 * among that context's sections, before the text and the fill and stroke.
 */
export const stylePanelSection: StylePanelSection = {
  id: 'shape',
  title: 'Shape',
  context: 'shape',
  order: 5,
  render: ShapeControls,
};
