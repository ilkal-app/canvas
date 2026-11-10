import type { ReactElement } from 'react';

import { MAX_RADIAL_RADIUS, type Gradient } from '@canvas/schema';

import { NumberControl } from '../controls/number-control.js';

import {
  angleToDegrees,
  degreesToAngle,
  fractionToPercent,
  percentToFraction,
} from './gradient-edits.js';

/** The smallest radius the field takes, percent: the stored radius must stay above 0. */
const MIN_RADIUS_PERCENT = 1;

/** Props of {@link GradientGeometryFields}. */
export interface GradientGeometryFieldsProps {
  /** The gradient. */
  readonly gradient: Gradient;
  /** Receives the gradient with one field changed. */
  readonly onChange: (gradient: Gradient) => void;
}

/**
 * The numeric fields of a gradient's geometry: a linear gradient's Angle in
 * degrees (stored in radians, normalised into (−π, π], so 90 is π/2 and 180 and −180 are π); a
 * radial one's Centre X and Centre Y as percentages of the box, 0 to 100, and its Radius as a
 * percentage, 1 to 200 (stored as fractions: 25 is 0.25, 200 is 2). A value out of range is refused and the field shows the stored value
 * again; each committed value is one edit.
 *
 * @param props - The gradient and the change handler.
 * @returns The fields.
 */
export function GradientGeometryFields(props: GradientGeometryFieldsProps): ReactElement {
  const { gradient, onChange } = props;
  if (gradient.type === 'linear') {
    return (
      <NumberControl
        label="Angle"
        value={angleToDegrees(gradient.angle)}
        min={-360}
        max={360}
        step={1}
        onChange={(degrees) => {
          onChange({ ...gradient, angle: degreesToAngle(degrees) });
        }}
      />
    );
  }
  const { center } = gradient;
  return (
    <>
      <NumberControl
        label="Centre X"
        value={fractionToPercent(center.x)}
        min={0}
        max={100}
        step={1}
        onChange={(x) => {
          onChange({ ...gradient, center: { ...center, x: percentToFraction(x) } });
        }}
      />
      <NumberControl
        label="Centre Y"
        value={fractionToPercent(center.y)}
        min={0}
        max={100}
        step={1}
        onChange={(y) => {
          onChange({ ...gradient, center: { ...center, y: percentToFraction(y) } });
        }}
      />
      <NumberControl
        label="Radius"
        value={fractionToPercent(gradient.radius)}
        min={MIN_RADIUS_PERCENT}
        max={MAX_RADIAL_RADIUS * 100}
        step={1}
        onChange={(radius) => {
          onChange({ ...gradient, radius: percentToFraction(radius) });
        }}
      />
    </>
  );
}
