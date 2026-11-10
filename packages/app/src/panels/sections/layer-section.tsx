import type { ReactElement } from 'react';

import { LAYER_OPACITY_TYPES, layerOpacityOf, type BoardObject } from '@canvas/schema';

import { commonValue, MIXED } from '../controls/mixed-value.js';
import { NumberControl } from '../controls/number-control.js';
import { SliderControl } from '../controls/slider-control.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';

/** The types whose opacity the section edits: every layer that stores one, and images. */
const OPACITY_TYPES: ReadonlySet<BoardObject['type']> = new Set([...LAYER_OPACITY_TYPES, 'image']);

/**
 * Whether an object has an opacity the section edits.
 *
 * @param object - A selected object.
 * @returns True for a layer with a layer opacity, or an image.
 */
function hasOpacity(object: BoardObject): boolean {
  return OPACITY_TYPES.has(object.type);
}

/**
 * An object's opacity as the section shows it: a whole percentage of an image's own opacity, or
 * of any other layer's layer opacity (absent is 100).
 *
 * @param object - An object with an opacity.
 * @returns From 0 to 100.
 */
function percentOf(object: BoardObject): number {
  const opacity =
    object.type === 'image' ? object.opacity : layerOpacityOf(Reflect.get(object, 'opacity'));
  return Math.round(opacity * 100);
}

/**
 * The style panel's Layer section: the selected objects' opacity, as a 0–100%
 * slider and a percent field, Mixed when they differ. A slider drag previews in the slider and
 * commits on release; the field commits on Enter; each commit is one `setStyle` of `opacity`
 * over every selected object that has one (one undo step). 100% removes a layer's opacity
 * (absent is opaque) and gives an image its required 1. A container's opacity multiplies into
 * everything under it.
 *
 * @param props - The panel's props.
 * @returns The controls.
 */
function LayerSection(props: StylePanelSectionProps): ReactElement {
  const { selection, applyStyle } = props;
  const layers = selection.filter(hasOpacity);
  const percent = commonValue(layers, percentOf) ?? MIXED;
  const commit = (chosen: number): void => {
    const opacity = chosen / 100;
    applyStyle((object) => ({
      opacity: opacity === 1 && object?.type !== 'image' ? undefined : opacity,
    }));
  };
  return (
    <>
      <SliderControl
        label="Opacity"
        value={percent}
        min={0}
        max={100}
        format={(value) => `${String(value)}%`}
        onChange={commit}
      />
      <NumberControl label="Opacity" value={percent} min={0} max={100} onChange={commit} />
    </>
  );
}

/**
 * The style panel's Layer section: shown for a selection holding any object with an
 * opacity, in every context such an object has, right after the type's own section; never for a
 * creation tool's style.
 */
export const stylePanelSection: StylePanelSection = {
  id: 'layer',
  title: 'Layer',
  context: [
    'text',
    'note',
    'vector',
    'shape',
    'line',
    'image',
    'group',
    'frame',
    'component',
    'instance',
    'mixed',
  ],
  // After the type's own section (5) and before colour mode and auto-layout (6) and fill (7), as
  // Figma places its Layer section.
  order: 5.5,
  isSelectionOnly: true,
  isShownFor: (selection) => selection.some(hasOpacity),
  render: LayerSection,
};
