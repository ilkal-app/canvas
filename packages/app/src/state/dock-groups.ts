import type { ToolId } from '@canvas/tools';

import { dockButtonOfVariant, type DockButtonId } from './dock-buttons.js';
import type { ShellAction } from './shell-action.js';
import type { ToolStyles } from './tool-style.js';
import { toolButtonOf, toolVariantOf } from './tool-variants.js';

/** The dock's flyout groups: one button that opens a menu of related tools. */
export const DOCK_GROUP_IDS = ['shapes', 'lines'] as const;

/** One of {@link DOCK_GROUP_IDS}. */
export type DockGroupId = (typeof DOCK_GROUP_IDS)[number];

/** A flyout group: its name, its items in menu order, and the tools those items choose. */
export interface DockGroup {
  /** The menu's name (`Shapes`). */
  readonly label: string;
  /** Its items, in the menu's order. */
  readonly items: readonly DockButtonId[];
  /** The tools its items choose; the first is the group's until another is chosen. */
  readonly tools: readonly [ToolId, ...ToolId[]];
}

/**
 * The flyouts (Figma "Dock · modes & flyouts"): shapes▾ holds the shape tool's presets, lines▾ the
 * line tool's and the connector's.
 */
export const DOCK_GROUPS: Readonly<Record<DockGroupId, DockGroup>> = {
  shapes: {
    label: 'Shapes',
    items: ['rectangle', 'ellipse', 'triangle', 'polygon', 'star'],
    tools: ['shape'],
  },
  lines: {
    label: 'Lines',
    items: ['line', 'arrow', 'elbow-connector', 'connector'],
    tools: ['line', 'connector'],
  },
};

/** The tool each group's button stands for: the one last chosen from it. */
export type DockGroupTools = Readonly<Record<DockGroupId, ToolId>>;

/** Each group's tool before any is chosen: its first. */
export const INITIAL_DOCK_GROUP_TOOLS: DockGroupTools = {
  shapes: DOCK_GROUPS.shapes.tools[0],
  lines: DOCK_GROUPS.lines.tools[0],
};

/**
 * The group a tool's flyout items belong to.
 *
 * @param tool - The tool.
 * @returns The group, or `undefined` for a tool outside every flyout.
 */
export function dockGroupOfTool(tool: ToolId): DockGroupId | undefined {
  return DOCK_GROUP_IDS.find((group) => DOCK_GROUPS[group].tools.includes(tool));
}

/**
 * Records the tool last chosen from its group, so the group's button stands for it; the same
 * object when nothing changes. Pure.
 *
 * @param groupTools - Each group's tool.
 * @param tool - The tool made active.
 * @returns The groups' tools.
 */
export function withDockGroupTool(groupTools: DockGroupTools, tool: ToolId): DockGroupTools {
  const group = dockGroupOfTool(tool);
  if (group === undefined || groupTools[group] === tool) return groupTools;
  return { ...groupTools, [group]: tool };
}

/** What a flyout group's button shows and does. */
export interface DockGroupButtonModel {
  /** The tool it stands for. */
  readonly tool: ToolId;
  /** The item it shows: the variant of that tool in use; none for one no item chooses. */
  readonly item: DockButtonId | undefined;
  /** Its visible name: the variant in use's (`Ellipse`). */
  readonly label: string;
  /** Its accessible name before the shortcut (`Shape: Ellipse`, `Line: Arrow`, `Connector`). */
  readonly name: string;
  /** What pressing it dispatches: the item in use chosen again. */
  readonly action: ShellAction;
}

/**
 * The button of a flyout group: the item last chosen shows on it, named as the tool's
 * variant is (`Shape: Star`, `Line: Arrow`), and pressing it chooses that item again, as the
 * item's shortcut does. A shape kind picked in the panel that no item chooses (the diamond)
 * shows by name and keeps the tool as it is. Pure.
 *
 * @param group - The group.
 * @param groupTools - Each group's tool (`ShellState.dockGroupTools`).
 * @param toolStyles - The person's choices per tool.
 * @returns The button's model.
 */
export function dockGroupButtonOf(
  group: DockGroupId,
  groupTools: DockGroupTools,
  toolStyles: ToolStyles,
): DockGroupButtonModel {
  const tool = groupTools[group];
  const button = toolButtonOf(tool, toolStyles);
  return { tool, item: dockButtonOfVariant(toolVariantOf(tool, toolStyles)), ...button };
}
