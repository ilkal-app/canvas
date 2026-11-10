import type { ReactElement } from 'react';

import {
  DEFAULT_SHADOW,
  MAX_SHADOW_BLUR,
  MAX_SHADOW_OFFSET,
  MAX_SHADOW_SPREAD,
  shadowLayersOf,
  type BoardObject,
  type Rgba,
  type Shadow,
} from '@canvas/schema';

import { ColourControl } from '../controls/colour-control.js';
import controls from '../controls/controls.module.css';
import { commonValue, isSameColour, MIXED } from '../controls/mixed-value.js';
import { NumberControl } from '../controls/number-control.js';
import { ToggleControl } from '../controls/toggle-control.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';

/** The numeric fields of a shadow the section edits, with their labels and ranges. */
const SHADOW_FIELDS: readonly {
  readonly field: 'x' | 'y' | 'blur' | 'spread';
  readonly label: string;
  readonly shortLabel: string;
  readonly min: number;
  readonly max: number;
}[] = [
  {
    field: 'x',
    label: 'Shadow x',
    shortLabel: 'X',
    min: -MAX_SHADOW_OFFSET,
    max: MAX_SHADOW_OFFSET,
  },
  {
    field: 'y',
    label: 'Shadow y',
    shortLabel: 'Y',
    min: -MAX_SHADOW_OFFSET,
    max: MAX_SHADOW_OFFSET,
  },
  { field: 'blur', label: 'Shadow blur', shortLabel: 'Blur', min: 0, max: MAX_SHADOW_BLUR },
  {
    field: 'spread',
    label: 'Shadow spread',
    shortLabel: 'Spread',
    min: -MAX_SHADOW_SPREAD,
    max: MAX_SHADOW_SPREAD,
  },
];

/**
 * An object's drop shadow, as the section reads it: a shape's or frame's (absent and null are
 * none), its top layer when it has several; none for anything else.
 *
 * @param object - The object.
 * @returns The shadow, or undefined.
 */
function shadowOf(object: BoardObject | undefined): Shadow | undefined {
  if (object?.type !== 'shape' && object?.type !== 'frame') return undefined;
  return shadowLayersOf(object.shadow).at(-1);
}

/**
 * An object's shadow with its top layer changed: a single shadow is replaced, and a
 * list of layers keeps its other layers.
 *
 * @param object - The object.
 * @param change - The change to its top layer.
 * @returns The shadow field to write, or undefined when it has none.
 */
function withTopLayer(
  object: BoardObject | undefined,
  change: (shadow: Shadow) => Shadow,
): Shadow | Shadow[] | undefined {
  if (object?.type !== 'shape' && object?.type !== 'frame') return undefined;
  const layers = shadowLayersOf(object.shadow);
  const top = layers.at(-1);
  if (top === undefined) return undefined;
  const changed = change(top);
  return layers.length === 1 ? changed : [...layers.slice(0, -1), changed];
}

/**
 * The opacity a shadow's alpha shows as, a whole percentage.
 *
 * @param shadow - The shadow.
 * @returns 0 to 100.
 */
function opacityOf(shadow: Shadow): number {
  return Math.round(shadow.color[3] * 100);
}

/**
 * The shadow controls of the shadowed objects selected: offset, blur, spread, colour and opacity,
 * each showing "Mixed" when they differ. Each change rewrites the shadow of every selected object
 * that has one, that field alone, as one style change.
 *
 * @param props - The panel's props.
 * @param shadows - The selected objects' shadows.
 * @returns The controls.
 */
function ShadowFields(props: StylePanelSectionProps, shadows: readonly Shadow[]): ReactElement {
  const edit = (change: (shadow: Shadow) => Shadow) => {
    props.applyStyle((object) => {
      const shadow = withTopLayer(object, change);
      return shadow === undefined ? {} : { shadow };
    });
  };
  const colour = commonValue(shadows, (shadow) => shadow.color, isSameColour) ?? MIXED;
  return (
    <>
      {SHADOW_FIELDS.map(({ field, label, shortLabel, min, max }) => (
        <NumberControl
          key={field}
          label={label}
          shortLabel={shortLabel}
          value={commonValue(shadows, (shadow) => shadow[field]) ?? MIXED}
          min={min}
          max={max}
          onChange={(value) => {
            edit((shadow) => ({ ...shadow, [field]: value }));
          }}
        />
      ))}
      <ColourControl
        label="Shadow colour"
        value={colour}
        onChange={(chosen: Rgba | null) => {
          if (chosen === null) return;
          // The picker has no alpha: each shadow keeps its own opacity.
          edit((shadow) => ({
            ...shadow,
            color: [chosen[0], chosen[1], chosen[2], shadow.color[3]],
          }));
        }}
      />
      <NumberControl
        label="Shadow opacity"
        shortLabel="Opacity"
        value={commonValue(shadows, opacityOf) ?? MIXED}
        min={0}
        max={100}
        step={1}
        onChange={(percent) => {
          const alpha = Math.min(1, Math.max(0, percent / 100));
          edit((shadow) => ({
            ...shadow,
            color: [shadow.color[0], shadow.color[1], shadow.color[2], alpha],
          }));
        }}
      />
    </>
  );
}

/**
 * The style panel's effects section: a drop shadow on the selected shapes and
 * frames. "Drop shadow" turns it on (Figma's default, `DEFAULT_SHADOW`: 4 down, blur 4, black at
 * 25%, on each object without one; mixed when only some have one) or off (`null`); while any has
 * one, its X and Y offset, blur, spread (world px), colour and opacity. Each committed change is
 * one `setStyle`, one undo step; a value chosen while the shadows differ sets that field alone.
 *
 * @param props - The panel's props.
 * @returns The controls.
 */
function EffectsControls(props: StylePanelSectionProps): ReactElement {
  const { selection, applyStyle } = props;
  const targets = selection.filter((object) => object.type === 'shape' || object.type === 'frame');
  const shadows = targets.flatMap((object) => shadowOf(object) ?? []);
  const hasShadow = commonValue(targets, (object) => shadowOf(object) !== undefined) ?? MIXED;
  return (
    <>
      <div className={controls.control}>
        <ToggleControl
          label="Drop shadow"
          value={hasShadow}
          onChange={(isOn) => {
            applyStyle((object) => {
              const own = shadowOf(object);
              if (!isOn) return own === undefined ? {} : { shadow: null };
              return own === undefined
                ? { shadow: { ...DEFAULT_SHADOW, color: [...DEFAULT_SHADOW.color] } }
                : {};
            });
          }}
        />
      </div>
      {shadows.length > 0 && ShadowFields(props, shadows)}
    </>
  );
}

/**
 * The effects section: shown for shapes and frames (the `shape` and `frame`
 * contexts), after their other sections (order 50; agreed with the auto-layout work: frame 5,
 * auto-layout 6, fill and stroke 7, effects 50), and only for a selection: the creation tools
 * keep no shadow of their own.
 */
export const stylePanelSection: StylePanelSection = {
  id: 'effects',
  title: 'Effects',
  context: ['shape', 'frame'],
  order: 50,
  isSelectionOnly: true,
  render: EffectsControls,
};
