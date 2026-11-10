import type { ShapeObject } from '@canvas/schema';
import { DEFAULT_SHAPE_STYLE, type ToolId } from '@canvas/tools';

import type { ShellAction } from './shell-action.js';
import { TOOL_LABELS } from './tool-labels.js';
import type { ToolStyle, ToolStyles } from './tool-style.js';

/**
 * A tool variant: one dock tool with some fields of its style set,
 * chosen by a shortcut of its own and shown on the tool's button while it is the one in use. The
 * arrow (Shift+L) is the line tool with an `arrow` end cap. A style preset of the
 * shell, not a mode: the pen's hand-off between modes (`ToolMode.onToolSwitch`) is its own thing.
 */
export interface ToolVariant {
  /** The dock tool. */
  readonly tool: ToolId;
  /** What the tool's button and the cheat sheet call it. */
  readonly label: string;
  /** The style fields choosing it sets on the tool's style. */
  readonly style: ToolStyle;
  /**
   * When present, a field of {@link ToolVariant.style} is set only while the tool's style holds
   * the value given here for it, so choosing the variant leaves a value the person chose in the
   * panel alone: the plain line turns the arrow's end cap back to none, and keeps a triangle.
   */
  readonly replaces?: ToolStyle;
  /**
   * Whether the variant is picked in the style panel rather than by a shortcut or flyout item of
   * its own (the diamond): the tool's button then chooses the tool plainly, which keeps
   * the variant in use, since it lives in the tool's style.
   */
  readonly isPickedInPanel?: boolean;
}

/** The line tool's plain line, `l`: leaves the arrow's end cap for none, keeps any other cap. */
export const LINE_VARIANT: ToolVariant = {
  tool: 'line',
  label: 'Line',
  style: { endCap: 'none' },
  replaces: { endCap: 'arrow' },
};

/** The line tool's arrow, Shift+L: an arrowhead at the end. */
export const ARROW_VARIANT: ToolVariant = {
  tool: 'line',
  label: 'Arrow',
  style: { endCap: 'arrow' },
};

/**
 * What each shape kind is called on the shape tool's button and in the style panel's kind list.
 */
export const SHAPE_KIND_LABELS: Readonly<Record<ShapeObject['kind'], string>> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  polygon: 'Polygon',
  star: 'Star',
};

/** The shape tool's rectangle, `r` (the shapes flyout's first item). */
export const RECTANGLE_VARIANT: ToolVariant = {
  tool: 'shape',
  label: 'Rectangle',
  style: { kind: 'rectangle' },
};

/** The shape tool's ellipse, `o`. */
export const ELLIPSE_VARIANT: ToolVariant = {
  tool: 'shape',
  label: 'Ellipse',
  style: { kind: 'ellipse' },
};

/**
 * The shape tool's triangle: a preset of the polygon kind with three sides, no kind of
 * its own, so nothing the document stores changes.
 */
export const TRIANGLE_VARIANT: ToolVariant = {
  tool: 'shape',
  label: 'Triangle',
  style: { kind: 'polygon', sides: 3 },
};

/**
 * The shape tool's polygon: the polygon kind, its sides back to the default only when the
 * triangle's three were in use, so a count picked in the panel stays.
 */
export const POLYGON_VARIANT: ToolVariant = {
  tool: 'shape',
  label: 'Polygon',
  style: { kind: 'polygon', sides: DEFAULT_SHAPE_STYLE.sides },
  replaces: { sides: 3 },
};

/** The shape tool's star: its points back to the default only after the triangle's three. */
export const STAR_VARIANT: ToolVariant = {
  tool: 'shape',
  label: 'Star',
  style: { kind: 'star', sides: DEFAULT_SHAPE_STYLE.sides },
  replaces: { sides: 3 },
};

/**
 * The shape tool's variants by kind: the flyout's presets, and the diamond, which is picked in
 * the style panel's kind list only, so the tool's button and shortcut keep it.
 */
export const SHAPE_VARIANTS: Readonly<Record<ShapeObject['kind'], ToolVariant>> = Object.freeze({
  rectangle: RECTANGLE_VARIANT,
  ellipse: ELLIPSE_VARIANT,
  diamond: {
    tool: 'shape',
    label: SHAPE_KIND_LABELS.diamond,
    style: { kind: 'diamond' },
    isPickedInPanel: true,
  },
  polygon: POLYGON_VARIANT,
  star: STAR_VARIANT,
});

/**
 * The connector tool's default route, `c`: straight, unless the elbow was in use, so a curved
 * route picked in the panel stays.
 */
export const CONNECTOR_VARIANT: ToolVariant = {
  tool: 'connector',
  label: 'Connector',
  style: { route: 'straight' },
  replaces: { route: 'elbow' },
};

/** The elbow connector: the connector tool with the elbow route. */
export const ELBOW_CONNECTOR_VARIANT: ToolVariant = {
  tool: 'connector',
  label: 'Elbow connector',
  style: { route: 'elbow' },
};

/**
 * The draw tool's drawing, Shift+P: leaves the eraser for the pencil, marker
 * or highlighter in use.
 */
export const DRAW_VARIANT: ToolVariant = {
  tool: 'draw',
  label: TOOL_LABELS.draw,
  style: { isEraser: false },
};

/**
 * The draw tool's eraser, Shift+E: a drag erases whole freehand strokes; the look
 * drawing returns to is kept.
 */
export const ERASER_VARIANT: ToolVariant = {
  tool: 'draw',
  label: 'Eraser',
  style: { isEraser: true },
};

/**
 * The variant a tool is in: for the line tool, the arrow while its style ends in an arrow, else
 * the plain line (a triangle or other head chosen in the panel is still a line); for the shape
 * tool, its kind's (a rectangle until another is picked), a three-sided polygon being the
 * triangle; for the connector, the elbow while its route is elbow, else the connector; nothing
 * for a tool without variants. Pure.
 *
 * @param tool - The tool.
 * @param toolStyles - The person's choices per tool (`ShellState.toolStyles`).
 * @returns The variant, or `undefined`.
 */
export function toolVariantOf(tool: ToolId, toolStyles: ToolStyles): ToolVariant | undefined {
  switch (tool) {
    case 'shape': {
      const style = toolStyles.shape;
      const kind = style?.kind ?? 'rectangle';
      return kind === 'polygon' && style?.sides === 3 ? TRIANGLE_VARIANT : SHAPE_VARIANTS[kind];
    }
    case 'line':
      return toolStyles.line?.endCap === 'arrow' ? ARROW_VARIANT : LINE_VARIANT;
    case 'connector':
      return toolStyles.connector?.route === 'elbow' ? ELBOW_CONNECTOR_VARIANT : CONNECTOR_VARIANT;
    default:
      return undefined;
  }
}

/**
 * The action that chooses a variant: the tool made active with the variant's style fields.
 *
 * @param variant - The variant.
 * @returns The action.
 */
export function toolVariantAction(variant: ToolVariant): ShellAction {
  const { tool, style, replaces } = variant;
  return replaces === undefined
    ? { type: 'selectTool', tool, style }
    : { type: 'selectTool', tool, style, replaces };
}

/** What a tool's toolbar button shows and dispatches. */
export interface ToolButtonModel {
  /** The name on the button: the variant in use's, else the tool's. */
  readonly label: string;
  /**
   * The name the button is announced by: the tool's, then the variant in use's when it names
   * something else (`Shape: Star`, `Line: Arrow`; `Line` for the plain line, `Pen`).
   */
  readonly name: string;
  /** What a click dispatches: the variant in use chosen again, else the tool plainly. */
  readonly action: ShellAction;
}

/**
 * What a tool's toolbar button shows and does (the toolbar's indicator follows the variant):
 * the variant in use's name, announced after the tool's, and choosing it again, so a click keeps
 * the variant (a variant picked in the panel by choosing the tool plainly, as its shortcut does);
 * a tool without variants shows its own name and is chosen plainly. Pure.
 *
 * @param tool - The tool.
 * @param toolStyles - The person's choices per tool.
 * @returns The button's label, name and action.
 */
export function toolButtonOf(tool: ToolId, toolStyles: ToolStyles): ToolButtonModel {
  const variant = toolVariantOf(tool, toolStyles);
  const plain: ShellAction = { type: 'selectTool', tool };
  const toolName = TOOL_LABELS[tool];
  if (variant === undefined) return { label: toolName, name: toolName, action: plain };
  const action = variant.isPickedInPanel === true ? plain : toolVariantAction(variant);
  const name = variant.label === toolName ? toolName : `${toolName}: ${variant.label}`;
  return { label: variant.label, name, action };
}
