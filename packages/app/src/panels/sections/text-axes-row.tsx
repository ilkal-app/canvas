import type { ReactElement } from 'react';

import type { FontVariations, FontWeight } from '@canvas/schema';
import type { TextStylePatch } from '@canvas/tools';

import type { TextStyleChange } from '../../engine/document-text.js';
import type { FamilyAxes } from '../../text-input/family-axes.js';
import { MIXED, type Mixable } from '../controls/mixed-value.js';
import { SliderControl } from '../controls/slider-control.js';

import styles from './text-style-section.module.css';

/** The weight axis's tag, which a run's weight drives unless its coordinates set it. */
const WEIGHT_AXIS = 'wght';

/** Props of {@link AxesRow}. */
export interface AxesRowProps {
  /** The family's axes and instances. */
  readonly axes: FamilyAxes;
  /** The text's shown style: a field missing is mixed. */
  readonly style: TextStylePatch;
  /**
   * Each axis's value across the targeted runs (`TextStyleContext.axisValues`): a tag no run
   * sets is absent; the shown coordinates are read when this is absent.
   */
  readonly axisValues?: Readonly<Record<string, Mixable<number>>> | undefined;
  /**
   * Sends a style change: a drag's previews, its end and its one commit.
   *
   * @param change - The change.
   */
  readonly onChange: (change: TextStyleChange) => void;
}

/**
 * The coordinate an axis slider shows: the text's own, else for the weight axis its
 * weight (which layout draws the axis at), else the axis's default; mixed when the text's
 * coordinates are, or for the weight axis when its weight is.
 *
 * @param tag - The axis.
 * @param fallback - The axis's default.
 * @param fontVariations - The text's coordinates; undefined when mixed.
 * @param weight - The text's weight; undefined when mixed.
 * @returns The coordinate, or `MIXED`.
 */
export function shownCoordinate(
  tag: string,
  fallback: number,
  fontVariations: FontVariations | undefined,
  weight: FontWeight | undefined,
): Mixable<number> {
  if (fontVariations === undefined) return MIXED;
  const own = fontVariations[tag];
  if (own !== undefined) return own;
  if (tag !== WEIGHT_AXIS) return fallback;
  return weight ?? MIXED;
}

/**
 * The variable axes row: one slider per axis the font does not hide, from its least to
 * its greatest value. A drag previews on the canvas and commits once on release, changing that
 * axis on every run and keeping their others (`fontVariationsAxes`).
 *
 * @param props - The axes, the style and the change callback.
 * @returns The row.
 */
export function AxesRow(props: AxesRowProps): ReactElement {
  const { axes, style, axisValues, onChange } = props;
  const valueOf = (tag: string, fallback: number): Mixable<number> =>
    axisValues === undefined
      ? shownCoordinate(tag, fallback, style.fontVariations, style.weight)
      : (axisValues[tag] ?? shownCoordinate(tag, fallback, {}, style.weight));
  const patchOf = (tag: string, value: number): TextStylePatch => ({
    fontVariationsAxes: { [tag]: value },
  });
  return (
    <div className={styles.axes} role="group" aria-label="Variable axes">
      {axes.axes
        .filter(({ isHidden }) => !isHidden)
        .map(({ tag, name, minimum, maximum, default: fallback }) => (
          <SliderControl
            key={tag}
            label={name}
            value={valueOf(tag, fallback)}
            min={minimum}
            max={maximum}
            onPreview={(value) => {
              onChange({ kind: 'preview', patch: patchOf(tag, value) });
            }}
            onPreviewEnd={() => {
              onChange({ kind: 'endPreview' });
            }}
            onChange={(value) => {
              onChange({ kind: 'style', patch: patchOf(tag, value) });
            }}
          />
        ))}
    </div>
  );
}

/**
 * Whether a family has an axis the row shows.
 *
 * @param axes - The family's axes, or undefined while loading.
 * @returns True when the row has a slider.
 */
export function hasShownAxes(axes: FamilyAxes | undefined): axes is FamilyAxes {
  return axes?.axes.some(({ isHidden }) => !isHidden) === true;
}
