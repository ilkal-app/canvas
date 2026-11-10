import { TOOL_IDS, type ToolId } from '@canvas/tools';

import { DOCK_BUTTON_IDS, DOCK_BUTTONS, type DockButtonId } from './dock-buttons.js';

/**
 * The issue that brings a disabled button's feature (its tracker id), or `no ticket yet`. A plain
 * string: the public repository's export strips this repository's issue ids.
 */
export type ToolTicket = string;

/** Whether a dock button can be used yet, and if not, which issue brings it. */
export type ToolAvailability =
  | {
      /** The button's feature exists: it chooses its tool, and its shortcut does. */
      readonly isAvailable: true;
    }
  | {
      /**
       * Not built yet: the button shows disabled ("not available yet"), stays in the dock's focus
       * order, and neither it nor a shortcut does anything.
       */
      readonly isAvailable: false;
      /** The issue that brings it (``), or `no ticket yet`; never shown to the person. */
      readonly ticket: ToolTicket;
    };

/** An available button. */
const AVAILABLE: ToolAvailability = { isAvailable: true };

/**
 * A button whose feature is not built yet.
 *
 * @param ticket - The issue that brings it, or `no ticket yet`.
 * @returns Its availability.
 */
function comingWith(ticket: ToolTicket): ToolAvailability {
  return { isAvailable: false, ticket };
}

/**
 * The one availability registry: every button of every board mode's dock, flyout items
 * included, says whether it can be used and, if not, which issue brings it. The dock shows every
 * button of its mode and never hides one; a feature ticket enables its button by changing its
 * entry here (and gives it a tool to choose in `DOCK_BUTTONS`). The `Record` type makes a new
 * button add its entry.
 */
export const TOOL_AVAILABILITY: Readonly<Record<DockButtonId, ToolAvailability>> = {
  select: AVAILABLE,
  hand: AVAILABLE,
  note: AVAILABLE,
  text: AVAILABLE,
  rectangle: AVAILABLE,
  ellipse: AVAILABLE,
  triangle: AVAILABLE,
  polygon: AVAILABLE,
  star: AVAILABLE,
  line: AVAILABLE,
  arrow: AVAILABLE,
  'elbow-connector': AVAILABLE,
  connector: AVAILABLE,
  image: AVAILABLE,
  pen: AVAILABLE,
  frame: AVAILABLE,
  comment: AVAILABLE,
  component: AVAILABLE,
  prototype: comingWith('no ticket yet'),
  diagram: comingWith(''),
  slide: comingWith('no ticket yet'),
  present: comingWith('no ticket yet'),
  pencil: comingWith('no ticket yet'),
  brush: comingWith('no ticket yet'),
  'shape-builder': comingWith('no ticket yet'),
  eraser: comingWith('no ticket yet'),
  keyframe: comingWith('no ticket yet'),
  'motion-path': comingWith('no ticket yet'),
  easing: comingWith('no ticket yet'),
  timeline: comingWith('no ticket yet'),
};

/**
 * The tools built before any dock button chooses them, reached by their shortcut alone: the
 * draw tool (Shift+P), until the floating dock's Draw button (/616) chooses it.
 */
export const SHORTCUT_ONLY_TOOLS: readonly ToolId[] = ['draw'];

/**
 * The tools that can be made active: those an available dock button chooses, and the
 * `SHORTCUT_ONLY_TOOLS`, in `TOOL_IDS` order. A tool reached only through a disabled
 * button is left out, so the reducer ignores a `selectTool` of it, from a button, a shortcut or
 * the harness.
 *
 * @param availability - Each button's availability; {@link TOOL_AVAILABILITY} unless given.
 * @returns The ids of the available tools.
 */
export function availableToolIds(
  availability: Readonly<Record<DockButtonId, ToolAvailability>> = TOOL_AVAILABILITY,
): ToolId[] {
  const tools = new Set<ToolId>(SHORTCUT_ONLY_TOOLS);
  for (const id of DOCK_BUTTON_IDS) {
    const { tool } = DOCK_BUTTONS[id];
    if (tool !== undefined && availability[id].isAvailable) tools.add(tool);
  }
  return TOOL_IDS.filter((tool) => tools.has(tool));
}
