import type { ReactElement } from 'react';

import { NOTE_COLORS } from '@canvas/tools';

import { Chip } from '../../controls/chip.js';
import {
  STICKY_CHOICES,
  STICKY_PANEL_ASPECTS,
  STICKY_PANEL_COLORS,
  stickyToolStyle,
  type StickyChoices,
  type StickyPanelAspect,
} from '../../state/panel-choices/sticky-choices.js';
import { ROVING_ITEM_ATTRIBUTE } from '../use-roving-focus.js';

import { PanelDivider } from './panel-controls.js';
import styles from './sticky-panel.module.css';
import { defineToolPanel, type ToolPanelContentsProps } from './tool-panel-contribution.js';

/** What the Sticky panel calls each size. */
const ASPECT_LABELS: Readonly<Record<StickyPanelAspect, string>> = {
  square: 'Square',
  wide: 'Wide',
};

/** The panel's hint: how to place a note and how to stack the next one below it. */
export const STICKY_PANEL_HINT = 'Click to place · ⇧ click to stack';

/** The hint's tooltip: the other way to stack, from a selected note. */
export const STICKY_PANEL_HINT_TITLE = '⇧N stacks a note below the selected one';

/**
 * A palette colour as CSS.
 *
 * @param name - The colour's name.
 * @returns Its `rgb()`.
 */
function cssColorOf(name: string): string {
  const color = NOTE_COLORS.find((candidate) => candidate.name === name)?.color ?? [1, 1, 1, 1];
  const [r, g, b] = color.map((channel) => Math.round(channel * 255));
  return `rgb(${String(r)} ${String(g)} ${String(b)})`;
}

/**
 * The Sticky panel's contents (the design's STICKY card and frame A): the six colours in
 * the design's order as one radio group of 20 px squares, a divider, the 64 px Square and Wide
 * chips, a divider and the hint "Click to place · ⇧ click to stack". Each choice is the next note's.
 *
 * @param props - The choices and their setter.
 * @returns The contents.
 */
function StickyPanelContents(props: ToolPanelContentsProps<StickyChoices>): ReactElement {
  const { choices, onChange } = props;
  return (
    <>
      <div role="radiogroup" aria-label="Sticky colour" className={styles.swatches}>
        {STICKY_PANEL_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={choices.color === color}
            aria-label={color}
            className={styles.swatch}
            style={{ background: cssColorOf(color) }}
            {...{ [ROVING_ITEM_ATTRIBUTE]: '' }}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              onChange({ ...choices, color });
            }}
          ></button>
        ))}
      </div>
      <PanelDivider />
      {STICKY_PANEL_ASPECTS.map((aspect) => (
        <Chip
          key={aspect}
          label={ASPECT_LABELS[aspect]}
          isActive={choices.aspect === aspect}
          dataAttributes={{ [ROVING_ITEM_ATTRIBUTE]: '' }}
          onToggle={() => {
            onChange({ ...choices, aspect });
          }}
        />
      ))}
      <PanelDivider />
      <span className={styles.hint} title={STICKY_PANEL_HINT_TITLE}>
        {STICKY_PANEL_HINT}
      </span>
    </>
  );
}

/**
 * The Sticky panel: its colour and size become the sticky tool's style, so the next
 * note placed (N, or a click) takes them.
 */
export const toolPanel = defineToolPanel<StickyChoices>({
  id: 'sticky',
  label: 'Sticky note',
  codec: STICKY_CHOICES,
  toolStyle: (choices) => ({
    tool: 'sticky',
    style: { ...stickyToolStyle(choices), aspect: choices.aspect },
  }),
  contents: StickyPanelContents,
});
