// The text section's Features toggles: ligatures, kerning, tabular figures and small
// caps, each an OpenType feature in the run's `fontFeatures`.
import type { ReactElement } from 'react';

import type { FontFeatures } from '@canvas/schema';

import type { TextStyleChange, TextStyleContext } from '../../engine/document-text.js';
import { MIXED, type Mixable } from '../controls/mixed-value.js';
import { ToggleControl } from '../controls/toggle-control.js';

import styles from './text-style-section.module.css';

/** Each toggle: its OpenType tag, label, short text, and whether the shaper applies it unasked. */
const FEATURES: readonly (readonly [tag: string, label: string, text: string, isOn: boolean])[] = [
  ['liga', 'Ligatures', 'fi', true],
  ['kern', 'Kerning', 'AV', true],
  ['tnum', 'Tabular figures', '01', false],
  ['smcp', 'Small caps', 'Sc', false],
];

/** Props of {@link FeaturesRow}. */
export interface FeaturesRowProps {
  /** What the section shows. */
  readonly context: TextStyleContext;
  /** Applies a change to the targeted text. */
  readonly onChange: (change: TextStyleChange) => void;
}

/**
 * The feature settings the targeted text shares: its record, `{}` for none, or mixed when the
 * runs differ (the shared style leaves `fontFeatures` out).
 *
 * @param context - The section's context.
 * @returns The shared settings.
 */
function shownFeatures(context: TextStyleContext): Mixable<FontFeatures> {
  const { style } = context;
  if (!('fontFeatures' in style)) return MIXED;
  return style.fontFeatures ?? {};
}

/**
 * The settings with one feature set: a value equal to the shaper's own is removed, and no
 * settings left removes the field (`null`). Pure.
 *
 * @param features - The shared settings, or mixed, which starts from none.
 * @param tag - The feature.
 * @param isOn - Whether it is turned on.
 * @param isDefault - Whether the shaper applies it unasked.
 * @returns The new settings, or `null` for none.
 */
function featuresWith(
  features: Mixable<FontFeatures>,
  tag: string,
  isOn: boolean,
  isDefault: boolean,
): FontFeatures | null {
  const kept = Object.entries(features === MIXED ? {} : features).filter(([key]) => key !== tag);
  const set = isOn === isDefault ? [] : [[tag, isOn ? 1 : 0] as const];
  const next = [...kept, ...set];
  return next.length === 0 ? null : Object.fromEntries(next);
}

/**
 * The Features row: a toggle per feature, showing the shared setting or the shaper's
 * default when the text sets none, and mixed when the runs differ. Other features the text sets
 * are kept.
 *
 * @param props - The context and the change callback.
 * @returns The row.
 */
export function FeaturesRow(props: FeaturesRowProps): ReactElement {
  const { context, onChange } = props;
  const features = shownFeatures(context);
  return (
    <div className={styles.row} role="group" aria-label="Features">
      {FEATURES.map(([tag, label, text, isDefault]) => {
        const value = features === MIXED ? MIXED : (features[tag] ?? (isDefault ? 1 : 0)) !== 0;
        return (
          <ToggleControl
            key={tag}
            label={label}
            value={value}
            onChange={(isOn) => {
              const fontFeatures = featuresWith(features, tag, isOn, isDefault);
              onChange({ kind: 'style', patch: { fontFeatures } });
            }}
          >
            {text}
          </ToggleControl>
        );
      })}
    </div>
  );
}
