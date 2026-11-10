import type { ReactElement } from 'react';

import { layerOpacityOf, type BoardObject, type OverrideRecord } from '@canvas/schema';

import { NumberControl } from '../controls/number-control.js';

import { ResetField } from './reset-field.js';

/**
 * A child's opacity as the main draws it, from 0 to 1: an image's own, any other layer's layer
 * opacity (absent is 1).
 *
 * @param source - The main's child.
 * @returns Its opacity.
 */
function sourceOpacity(source: BoardObject): number {
  return source.type === 'image' ? source.opacity : layerOpacityOf(Reflect.get(source, 'opacity'));
}

/** Props of {@link OverrideOpacityField}. */
export interface OverrideOpacityFieldProps {
  /** The main's child the row overrides. */
  readonly source: BoardObject;
  /** The row's record, if any. */
  readonly override: OverrideRecord | undefined;
  /** What its chosen variant's presets set, under the record. */
  readonly preset: OverrideRecord | undefined;
  /** Merges fields into the record. */
  readonly set: (record: OverrideRecord) => void;
  /** Clears the given fields of the record. */
  readonly reset: (cleared: readonly (keyof OverrideRecord)[]) => () => void;
}

/**
 * An override row's "Opacity": the child's opacity in percent (the record's, else
 * its preset's, else the main's), each commit one `setInstanceOverride` of `opacity`, with a
 * Reset clearing that field alone.
 *
 * @param props - The child, the record, the preset, and how to set and reset fields.
 * @returns The field with its reset.
 */
export function OverrideOpacityField(props: OverrideOpacityFieldProps): ReactElement {
  const { source, override, preset, set, reset } = props;
  const opacity = override?.opacity ?? preset?.opacity ?? sourceOpacity(source);
  return (
    <ResetField
      label="opacity"
      isOverridden={override?.opacity !== undefined}
      isFromVariant={preset?.opacity !== undefined}
      onReset={reset(['opacity'])}
    >
      <NumberControl
        label="Opacity"
        value={Math.round(opacity * 100)}
        min={0}
        max={100}
        onChange={(percent) => {
          set({ opacity: percent / 100 });
        }}
      />
    </ResetField>
  );
}
