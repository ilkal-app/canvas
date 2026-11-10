import type { ReactElement } from 'react';

import { isFontWeight } from '@canvas/schema';
import type { TextStylePatch } from '@canvas/tools';

import type { FamilyAxes } from '../../text-input/family-axes.js';
import { FONT_FAMILIES } from '../../text-input/font-catalogue.js';
import { MIXED } from '../controls/mixed-value.js';
import { SelectControl } from '../controls/select-control.js';

import {
  CUSTOM_INSTANCE,
  hasInstanceWeights,
  instanceOptions,
  instancePatch,
  selectedInstance,
} from './text-instances.js';
import { familyWeights, weightOptions } from './text-weights.js';

/** Props of {@link WeightControl}. */
export interface WeightControlProps {
  /** The text's shown style: a field missing is mixed. */
  readonly style: TextStylePatch;
  /** Whether text is being edited, so a choice hands the keyboard back. */
  readonly isEditing: boolean;
  /** The family's axes (`useFamilyAxes`); undefined while loading or for a static family. */
  readonly axes: FamilyAxes | undefined;
  /**
   * Sets style fields.
   *
   * @param patch - The fields.
   */
  readonly onStyle: (patch: TextStylePatch) => void;
}

/**
 * The weight field: a static family's weights, or a variable family's named instances,
 * choosing one setting its coordinates and the weight nearest its weight axis.
 *
 * @param props - The style and the change callback.
 * @returns The field.
 */
export function WeightControl(props: WeightControlProps): ReactElement {
  const { style, isEditing, axes, onStyle } = props;
  if (hasInstanceWeights(axes)) {
    const selected = selectedInstance(axes, style.fontVariations, style.weight);
    // Coordinates no instance has show as Custom, an option only while they are set.
    const custom =
      selected === CUSTOM_INSTANCE ? [{ value: CUSTOM_INSTANCE, label: CUSTOM_INSTANCE }] : [];
    return (
      <SelectControl
        label="Weight"
        value={selected}
        options={[...instanceOptions(axes), ...custom]}
        shouldReleaseFocus={isEditing}
        onChange={(chosen) => {
          const patch = instancePatch(axes, chosen);
          if (patch !== undefined) onStyle(patch);
        }}
      />
    );
  }
  return (
    <SelectControl
      label="Weight"
      value={style.weight === undefined ? MIXED : String(style.weight)}
      options={weightOptions(
        familyWeights(FONT_FAMILIES.find((entry) => entry.family === style.fontFamily)?.faces),
        style.weight,
      )}
      shouldReleaseFocus={isEditing}
      onChange={(chosen) => {
        // An unchanged choice still reaches the editor, handing the keyboard back.
        const weight = Number(chosen);
        if (isFontWeight(weight)) onStyle({ weight });
      }}
    />
  );
}
