import type { ReactElement } from 'react';

import type { IconName } from '../../icons/icon-paths.js';
import { Icon } from '../../icons/icon.js';
import {
  DRAW_CHOICES,
  DRAW_PANEL_COLOURS,
  DRAW_PANEL_SIZES,
  DRAW_PANEL_SUB_TOOLS,
  drawPanelToolStyle,
  withDrawKey,
  withDrawLook,
  withDrawSubTool,
  type DrawChoices,
  type DrawPanelColour,
  type DrawPanelSize,
  type DrawPanelSubTool,
} from '../../state/panel-choices/draw-choices.js';
import { ROVING_ITEM_ATTRIBUTE } from '../use-roving-focus.js';

import styles from './draw-panel.module.css';
import { defineToolPanel, type ToolPanelContentsProps } from './tool-panel-contribution.js';

/** The roving-focus mark every panel item carries (`useRovingFocus`). */
const PANEL_ITEM = { [ROVING_ITEM_ATTRIBUTE]: '' } as const;

/**
 * Each sub-tool's name and icon: the floating chrome draws them as the design Library's
 * (`LIBRARY_ICON_PATHS`); the marker is the brush.
 */
const SUB_TOOL_BUTTONS: Readonly<
  Record<DrawPanelSubTool, { readonly label: string; readonly icon: IconName }>
> = {
  pencil: { label: 'Pencil', icon: 'pencil' },
  marker: { label: 'Marker', icon: 'brush' },
  highlighter: { label: 'Highlighter', icon: 'highlighter' },
  eraser: { label: 'Eraser', icon: 'eraser' },
};

/** What the Draw panel calls each colour (the design's tokens). */
const COLOUR_LABELS: Readonly<Record<DrawPanelColour, string>> = {
  ink: 'Ink',
  red: 'Red pencil',
  blue: 'Slate blue',
  green: 'Green',
  amber: 'Amber',
};

/** What the Draw panel calls each size. */
const SIZE_LABELS: Readonly<Record<DrawPanelSize, string>> = {
  0: 'Fine',
  1: 'Medium',
  2: 'Bold',
};

/**
 * Keeps focus where it was on a mouse press, so the canvas keeps its keys.
 *
 * @param event - The press.
 * @param event.preventDefault - Stops the focus move.
 */
function keepFocus(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

/**
 * The four sub-tool buttons, the chosen one pressed.
 *
 * @param props - The choices and their setter.
 * @returns The group.
 */
function SubToolButtons(props: ToolPanelContentsProps<DrawChoices>): ReactElement {
  const { choices, onChange } = props;
  return (
    <div role="group" aria-label="Draw tool" className={styles.group}>
      {DRAW_PANEL_SUB_TOOLS.map((subTool) => (
        <button
          key={subTool}
          type="button"
          className={styles.tool}
          aria-label={SUB_TOOL_BUTTONS[subTool].label}
          title={SUB_TOOL_BUTTONS[subTool].label}
          aria-pressed={choices.subTool === subTool}
          {...PANEL_ITEM}
          onMouseDown={keepFocus}
          onClick={() => {
            onChange(withDrawSubTool(choices, subTool));
          }}
        >
          <Icon name={SUB_TOOL_BUTTONS[subTool].icon} />
        </button>
      ))}
    </div>
  );
}

/**
 * The five colour swatches of the drawing sub-tool, its own colour pressed; faded and inert
 * while the eraser is in use. Each shows its design token in the theme in use (`data-colour`);
 * the stroke stores the colour of `DRAW_PANEL_COLOUR_VALUES`.
 *
 * @param props - The choices and their setter.
 * @returns The group.
 */
function ColourSwatches(props: ToolPanelContentsProps<DrawChoices>): ReactElement {
  const { choices, onChange } = props;
  const isErasing = choices.subTool === 'eraser';
  const chosen = choices.looks[choices.drawingTool].colour;
  return (
    <div role="group" aria-label="Colour" className={styles.group}>
      {DRAW_PANEL_COLOURS.map((colour) => (
        <button
          key={colour}
          type="button"
          className={styles.swatch}
          data-colour={colour}
          aria-label={COLOUR_LABELS[colour]}
          title={COLOUR_LABELS[colour]}
          aria-pressed={chosen === colour}
          aria-disabled={isErasing}
          {...PANEL_ITEM}
          onMouseDown={keepFocus}
          onClick={() => {
            if (!isErasing) onChange(withDrawLook(choices, { colour }));
          }}
        />
      ))}
    </div>
  );
}

/**
 * The three size buttons of the drawing sub-tool, its own size pressed; faded and inert while
 * the eraser is in use.
 *
 * @param props - The choices and their setter.
 * @returns The group.
 */
function SizeButtons(props: ToolPanelContentsProps<DrawChoices>): ReactElement {
  const { choices, onChange } = props;
  const isErasing = choices.subTool === 'eraser';
  const chosen = choices.looks[choices.drawingTool].size;
  return (
    <div role="group" aria-label="Size" className={styles.group}>
      {DRAW_PANEL_SIZES.map((size) => (
        <button
          key={size}
          type="button"
          className={styles.size}
          aria-label={SIZE_LABELS[size]}
          title={SIZE_LABELS[size]}
          aria-pressed={chosen === size}
          aria-disabled={isErasing}
          {...PANEL_ITEM}
          onMouseDown={keepFocus}
          onClick={() => {
            if (!isErasing) onChange(withDrawLook(choices, { size }));
          }}
        >
          <span className={styles.dot} data-size={String(size)} />
        </button>
      ))}
    </div>
  );
}

/**
 * The Draw panel's contents (the design's DRAW card): the pencil, marker, highlighter
 * and eraser, a divider, five colours, a divider and three sizes. Each drawing sub-tool keeps
 * its own colour and size; while the eraser is in use the colours and sizes show the look
 * drawing returns to, faded and inert (they stay in the focus order, announced disabled).
 *
 * @param props - The choices and their setter.
 * @returns The contents.
 */
function DrawPanelContents(props: ToolPanelContentsProps<DrawChoices>): ReactElement {
  return (
    <>
      <SubToolButtons {...props} />
      <span className={styles.divider} aria-hidden="true" />
      <ColourSwatches {...props} />
      <span className={styles.divider} aria-hidden="true" />
      <SizeButtons {...props} />
    </>
  );
}

/**
 * The Draw panel: its sub-tool, colour and size become the draw tool's style, so the
 * next stroke takes them, and the eraser erases. Under the floating chrome P cycles the drawing
 * sub-tools and E chooses the eraser while drawing (`withDrawKey`).
 */
export const toolPanel = defineToolPanel<DrawChoices>({
  id: 'draw',
  label: 'Draw',
  codec: DRAW_CHOICES,
  toolStyle: (choices) => ({
    tool: 'draw',
    style: drawPanelToolStyle(choices),
    // The panel's Ink is a pick: strokes keep the theme-aware `ink`, never a contrasting colour.
    isInkPick: choices.looks[choices.drawingTool].colour === 'ink',
  }),
  onKey: withDrawKey,
  contents: DrawPanelContents,
});
