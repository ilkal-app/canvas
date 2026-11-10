import type { ToolId } from '@canvas/tools';

import type { ShellAction } from './shell-action.js';
import { TOOL_LABELS } from './tool-labels.js';
import {
  ARROW_VARIANT,
  CONNECTOR_VARIANT,
  ELBOW_CONNECTOR_VARIANT,
  ELLIPSE_VARIANT,
  LINE_VARIANT,
  POLYGON_VARIANT,
  RECTANGLE_VARIANT,
  STAR_VARIANT,
  toolVariantAction,
  TRIANGLE_VARIANT,
  type ToolVariant,
} from './tool-variants.js';

/**
 * Every button any board mode's dock shows (Figma "Dock · modes & flyouts"), flyout
 * items included: the tools built today and the ones whose features come later, which show
 * disabled (`TOOL_AVAILABILITY`).
 */
export const DOCK_BUTTON_IDS = [
  'select',
  'hand',
  'note',
  'text',
  'rectangle',
  'ellipse',
  'triangle',
  'polygon',
  'star',
  'line',
  'arrow',
  'elbow-connector',
  'connector',
  'image',
  'pen',
  'frame',
  'comment',
  'component',
  'prototype',
  'diagram',
  'slide',
  'present',
  'pencil',
  'brush',
  'shape-builder',
  'eraser',
  'keyframe',
  'motion-path',
  'easing',
  'timeline',
] as const;

/** One of {@link DOCK_BUTTON_IDS}. */
export type DockButtonId = (typeof DOCK_BUTTON_IDS)[number];

/**
 * A dock button: what it is called, and the tool (and variant of it) it chooses, or the action
 * it runs, if any.
 */
export interface DockButtonDefinition {
  /** Its name: the button's accessible name and tooltip, before its shortcut. */
  readonly label: string;
  /**
   * The interaction mode it makes active, for a button whose tool exists; none for the comment
   * button (the site's comment placement), for a button that runs an action, and for a
   * tool not built yet.
   */
  readonly tool?: ToolId;
  /** The variant of the tool it chooses (the arrow, the triangle), if it chooses one. */
  readonly variant?: ToolVariant;
  /**
   * What a button that is not a tool does when chosen: the component button makes a component
   * of the selection (ruling 2), as `mod+alt+k` does.
   */
  readonly action?: ShellAction;
}

/**
 * A button that chooses a variant of a tool.
 *
 * @param variant - The variant.
 * @returns The definition.
 */
function variantButton(variant: ToolVariant): DockButtonDefinition {
  return { label: variant.label, tool: variant.tool, variant };
}

/**
 * A button that chooses a tool plainly.
 *
 * @param tool - The tool.
 * @returns The definition.
 */
function toolButton(tool: ToolId): DockButtonDefinition {
  return { label: TOOL_LABELS[tool], tool };
}

/** Every dock button's definition. */
export const DOCK_BUTTONS: Readonly<Record<DockButtonId, DockButtonDefinition>> = {
  select: toolButton('select'),
  hand: toolButton('hand'),
  note: toolButton('sticky'),
  text: toolButton('text'),
  rectangle: variantButton(RECTANGLE_VARIANT),
  ellipse: variantButton(ELLIPSE_VARIANT),
  triangle: variantButton(TRIANGLE_VARIANT),
  polygon: variantButton(POLYGON_VARIANT),
  star: variantButton(STAR_VARIANT),
  line: variantButton(LINE_VARIANT),
  arrow: variantButton(ARROW_VARIANT),
  'elbow-connector': variantButton(ELBOW_CONNECTOR_VARIANT),
  connector: variantButton(CONNECTOR_VARIANT),
  image: toolButton('image'),
  pen: toolButton('pen'),
  frame: toolButton('frame'),
  comment: { label: 'Comment' },
  component: { label: 'Create component', action: { type: 'arrange', command: 'createComponent' } },
  prototype: { label: 'Prototype' },
  diagram: { label: 'Auto-layout' },
  slide: { label: 'Slide' },
  present: { label: 'Present' },
  pencil: { label: 'Pencil' },
  brush: { label: 'Brush' },
  'shape-builder': { label: 'Shape builder' },
  eraser: { label: 'Eraser' },
  keyframe: { label: 'Keyframe' },
  'motion-path': { label: 'Motion path' },
  easing: { label: 'Easing' },
  timeline: { label: 'Timeline' },
};

/**
 * What choosing a dock button dispatches: its variant chosen (the arrow's end cap set), its
 * tool made active, or its own action (create component); none for a button without any (the
 * comment button acts on the site's comment placement instead).
 *
 * @param id - The button.
 * @returns The action, or `undefined`.
 */
export function dockButtonAction(id: DockButtonId): ShellAction | undefined {
  const { tool, variant, action } = DOCK_BUTTONS[id];
  if (action !== undefined) return action;
  if (variant !== undefined) return toolVariantAction(variant);
  return tool === undefined ? undefined : { type: 'selectTool', tool };
}

/**
 * The button that chooses a variant, by identity: the flyout item a tool's variant in use is.
 *
 * @param variant - The variant, if any.
 * @returns The button, or `undefined` for a variant no button chooses (the diamond).
 */
export function dockButtonOfVariant(variant: ToolVariant | undefined): DockButtonId | undefined {
  if (variant === undefined) return undefined;
  return DOCK_BUTTON_IDS.find((id) => DOCK_BUTTONS[id].variant === variant);
}
