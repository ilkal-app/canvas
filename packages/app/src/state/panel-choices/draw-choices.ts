import type { FreehandTool, INK, Rgba } from '@canvas/schema';

import { THEMES } from '../../theme/theme-tokens.js';
import { DEFAULT_DRAW_STYLES, HIGHLIGHTER_AMBER } from '../../tool-styles/draw-style.js';
import { storedField, type ToolPanelChoiceCodec } from '../tool-panel-choices.js';
import type { ToolPanelKey } from '../tool-panel-key.js';
import type { ToolStyle } from '../tool-style.js';

/** The draw tool's drawing sub-tools, in the Draw panel's order. */
export const DRAW_PANEL_TOOLS = [
  'pencil',
  'marker',
  'highlighter',
] as const satisfies readonly FreehandTool[];

/** The Draw panel's sub-tools: the three that draw, then the eraser. */
export const DRAW_PANEL_SUB_TOOLS = [...DRAW_PANEL_TOOLS, 'eraser'] as const;

/** One of {@link DRAW_PANEL_SUB_TOOLS}. */
export type DrawPanelSubTool = (typeof DRAW_PANEL_SUB_TOOLS)[number];

/**
 * The Draw panel's five colours, in the design's order (the DRAW card): ink, red pencil, slate
 * blue, green and amber.
 */
export const DRAW_PANEL_COLOURS = ['ink', 'red', 'blue', 'green', 'amber'] as const;

/** One of {@link DRAW_PANEL_COLOURS}. */
export type DrawPanelColour = (typeof DRAW_PANEL_COLOURS)[number];

/** The Draw panel's three sizes: 0 the finest, 1 the middle (each sub-tool's default), 2 the boldest. */
export const DRAW_PANEL_SIZES = [0, 1, 2] as const;

/** One of {@link DRAW_PANEL_SIZES}. */
export type DrawPanelSize = (typeof DRAW_PANEL_SIZES)[number];

/** What a drawing sub-tool remembers in the Draw panel: its own colour and size. */
export interface DrawPanelLook {
  /** The colour. */
  readonly colour: DrawPanelColour;
  /** The size. */
  readonly size: DrawPanelSize;
}

/** What the Draw panel holds. */
export interface DrawChoices {
  /** The sub-tool in use. */
  readonly subTool: DrawPanelSubTool;
  /**
   * The drawing sub-tool last chosen: the one in use, or while erasing the look drawing returns
   * to (the eraser keeps it).
   */
  readonly drawingTool: FreehandTool;
  /** Each drawing sub-tool's own colour and size. */
  readonly looks: Readonly<Record<FreehandTool, DrawPanelLook>>;
}

/**
 * Each size's stroke width per drawing sub-tool, world px at full pressure: the middle is the
 * draw tool's default (`DEFAULT_DRAW_STYLES`).
 */
export const DRAW_PANEL_WIDTHS: Readonly<Record<FreehandTool, readonly [number, number, number]>> =
  {
    pencil: [1, 2, 4],
    marker: [4, 6, 10],
    highlighter: [10, 16, 24],
  };

/**
 * A theme token's colour in the light theme (Vellum), as numbers, opaque.
 *
 * @param token - The token.
 * @returns The colour.
 */
function lightTokenColour(token: keyof (typeof THEMES)['light']): Rgba {
  const hex = THEMES.light[token];
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map(
    (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255,
  );
  return [red, green, blue, 1];
}

/**
 * The colour each Draw panel colour stores on a stroke. Ink is the theme-aware `ink` (each
 * viewer's `ink/primary`); a stroke stores no app theme token, so red pencil (`mark/red-pencil`),
 * slate blue (`hand/agent`) and green (`mark/live`) store the light theme's values, the same for
 * every viewer, and amber (`hand/you`) is the draw tool's highlighter amber, the same value.
 */
export const DRAW_PANEL_COLOUR_VALUES: Readonly<Record<DrawPanelColour, Rgba | typeof INK>> = {
  ink: 'ink',
  red: lightTokenColour('--color-mark-red-pencil'),
  blue: lightTokenColour('--color-hand-agent'),
  green: lightTokenColour('--color-mark-live'),
  amber: HIGHLIGHTER_AMBER,
};

const isSubTool = (value: unknown): value is DrawPanelSubTool =>
  (DRAW_PANEL_SUB_TOOLS as readonly unknown[]).includes(value);
const isDrawingTool = (value: unknown): value is FreehandTool =>
  (DRAW_PANEL_TOOLS as readonly unknown[]).includes(value);
const isColour = (value: unknown): value is DrawPanelColour =>
  (DRAW_PANEL_COLOURS as readonly unknown[]).includes(value);
const isSize = (value: unknown): value is DrawPanelSize =>
  (DRAW_PANEL_SIZES as readonly unknown[]).includes(value);
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The choices before the person makes any: the pencil in ink, every sub-tool at the middle size. */
const DEFAULT_DRAW_CHOICES: DrawChoices = {
  subTool: 'pencil',
  drawingTool: 'pencil',
  looks: {
    pencil: { colour: 'ink', size: 1 },
    marker: { colour: 'ink', size: 1 },
    highlighter: { colour: 'amber', size: 1 },
  },
};

/**
 * Reads one sub-tool's stored look, field by field.
 *
 * @param looks - The stored looks, of any shape.
 * @param tool - The sub-tool.
 * @returns Its look.
 */
function parseLook(looks: unknown, tool: FreehandTool): DrawPanelLook {
  const fallback = DEFAULT_DRAW_CHOICES.looks[tool];
  const stored = storedField(looks, tool, isRecord, {});
  return {
    colour: storedField(stored, 'colour', isColour, fallback.colour),
    size: storedField(stored, 'size', isSize, fallback.size),
  };
}

/**
 * Reads stored Draw panel choices back, field by field: a missing or invalid field takes its
 * default, and a drawing sub-tool in use is the one drawing returns to. Pure.
 *
 * @param stored - The parsed JSON that was stored, of any shape.
 * @returns The choices.
 */
function parseDrawChoices(stored: unknown): DrawChoices {
  const subTool = storedField(stored, 'subTool', isSubTool, DEFAULT_DRAW_CHOICES.subTool);
  const drawingTool =
    subTool === 'eraser'
      ? storedField(stored, 'drawingTool', isDrawingTool, DEFAULT_DRAW_CHOICES.drawingTool)
      : subTool;
  const looks = storedField(stored, 'looks', isRecord, {});
  return {
    subTool,
    drawingTool,
    looks: {
      pencil: parseLook(looks, 'pencil'),
      marker: parseLook(looks, 'marker'),
      highlighter: parseLook(looks, 'highlighter'),
    },
  };
}

/**
 * The Draw panel's choices, kept under `canvas.tool-panel.draw`: the pencil, each
 * sub-tool at its middle size, the highlighter in amber and the others in ink.
 */
export const DRAW_CHOICES: ToolPanelChoiceCodec<DrawChoices> = {
  id: 'draw',
  defaults: DEFAULT_DRAW_CHOICES,
  parse: parseDrawChoices,
};

/**
 * The choices with a sub-tool chosen: a drawing one becomes the one drawing returns to; the
 * eraser keeps the last. Pure.
 *
 * @param choices - The choices.
 * @param subTool - The sub-tool.
 * @returns The new choices.
 */
export function withDrawSubTool(choices: DrawChoices, subTool: DrawPanelSubTool): DrawChoices {
  return { ...choices, subTool, drawingTool: subTool === 'eraser' ? choices.drawingTool : subTool };
}

/**
 * The choices after a Draw panel key: P (`cycle`) goes pencil, marker, highlighter
 * and back to the pencil, and from the eraser back to the drawing sub-tool last chosen; E
 * (`eraser`) chooses the eraser. Each drawing sub-tool keeps its colour and size. Pure.
 *
 * @param choices - The choices.
 * @param key - The key.
 * @returns The new choices.
 */
export function withDrawKey(choices: DrawChoices, key: ToolPanelKey): DrawChoices {
  if (key === 'eraser') return withDrawSubTool(choices, 'eraser');
  if (choices.subTool === 'eraser') return withDrawSubTool(choices, choices.drawingTool);
  const index = DRAW_PANEL_TOOLS.indexOf(choices.drawingTool);
  return withDrawSubTool(
    choices,
    DRAW_PANEL_TOOLS[(index + 1) % DRAW_PANEL_TOOLS.length] ?? 'pencil',
  );
}

/**
 * The choices with the drawing sub-tool's colour or size changed; the others keep theirs. Pure.
 *
 * @param choices - The choices.
 * @param change - The fields to set.
 * @returns The new choices.
 */
export function withDrawLook(choices: DrawChoices, change: Partial<DrawPanelLook>): DrawChoices {
  const tool = choices.drawingTool;
  return { ...choices, looks: { ...choices.looks, [tool]: { ...choices.looks[tool], ...change } } };
}

/**
 * The draw tool's style the Draw panel's choices give: the drawing sub-tool, the
 * stroke of its colour and size, the highlighter's 40% opacity (none for the others, so a
 * highlighter's never carries over), and whether the eraser is in use. Pure.
 *
 * @param choices - The panel's choices.
 * @returns The style the next stroke takes.
 */
export function drawPanelToolStyle(choices: DrawChoices): ToolStyle {
  const tool = choices.drawingTool;
  const look = choices.looks[tool];
  return {
    tool,
    stroke: {
      color: DRAW_PANEL_COLOUR_VALUES[look.colour],
      width: DRAW_PANEL_WIDTHS[tool][look.size],
    },
    opacity: DEFAULT_DRAW_STYLES[tool].opacity,
    isEraser: choices.subTool === 'eraser',
  };
}
