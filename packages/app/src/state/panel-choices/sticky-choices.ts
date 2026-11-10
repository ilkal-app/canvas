import type { StylePatch } from '@canvas/document';
import { NOTE_COLORS } from '@canvas/tools';

import { storedField, type ToolPanelChoiceCodec } from '../tool-panel-choices.js';

/**
 * The sticky colours the Sticky panel offers, in the design's order (`NOTE_COLORS` has
 * Orange before Purple). Each names a colour of the tools' palette.
 */
export const STICKY_PANEL_COLORS = ['Yellow', 'Pink', 'Green', 'Blue', 'Purple', 'Orange'] as const;

/** One of {@link STICKY_PANEL_COLORS}. */
export type StickyPanelColor = (typeof STICKY_PANEL_COLORS)[number];

/** The sizes the Sticky panel offers: today's square note, or a 2:1 wide one. */
export const STICKY_PANEL_ASPECTS = ['square', 'wide'] as const;

/** One of {@link STICKY_PANEL_ASPECTS}. */
export type StickyPanelAspect = (typeof STICKY_PANEL_ASPECTS)[number];

/** What the Sticky panel holds: the next note's colour and size. */
export interface StickyChoices {
  /** The colour's palette name. */
  readonly color: StickyPanelColor;
  /** Square or wide. */
  readonly aspect: StickyPanelAspect;
}

const isColor = (value: unknown): value is StickyPanelColor =>
  (STICKY_PANEL_COLORS as readonly unknown[]).includes(value);
const isAspect = (value: unknown): value is StickyPanelAspect =>
  (STICKY_PANEL_ASPECTS as readonly unknown[]).includes(value);

/**
 * The Sticky panel's choices: a yellow square note; a stored field that is not valid
 * takes its default.
 */
export const STICKY_CHOICES: ToolPanelChoiceCodec<StickyChoices> = {
  id: 'sticky',
  defaults: { color: 'Yellow', aspect: 'square' },
  parse: (stored) => ({
    color: storedField(stored, 'color', isColor, STICKY_CHOICES.defaults.color),
    aspect: storedField(stored, 'aspect', isAspect, STICKY_CHOICES.defaults.aspect),
  }),
};

/**
 * The sticky tool's style the Sticky panel's colour gives: a copy of the palette
 * colour's RGBA. The size is read from the choices where the note is placed. Pure.
 *
 * @param choices - The panel's choices.
 * @returns The style the next note takes.
 * @throws {Error} When a panel colour is missing from the palette (a bug in the list).
 */
export function stickyToolStyle(choices: StickyChoices): StylePatch {
  const named = NOTE_COLORS.find(({ name }) => name === choices.color);
  if (named === undefined) throw new Error(`No sticky colour named ${choices.color}.`);
  return { color: [...named.color] };
}
