import type { ToolId } from '@canvas/tools';

import type { DockRole } from './dock-layout.js';
import type { ToolTicket } from './tool-availability.js';

/**
 * Every tool of the floating whiteboard dock (design "Dock tools and their
 * panels"), in the dock's order: Navigate, then Set the stage, then Collaborate. It is drawn
 * only under the `floating` chrome; the classic dock keeps `DOCK_LAYOUTS`.
 */
export const FLOATING_DOCK_TOOL_IDS = [
  'select',
  'pan',
  'section',
  'shapes',
  'image',
  'text',
  'connector',
  'draw',
  'sticky',
  'comment',
  'reactions',
] as const;

/** One of {@link FLOATING_DOCK_TOOL_IDS}. */
export type FloatingDockToolId = (typeof FLOATING_DOCK_TOOL_IDS)[number];

/**
 * The floating dock's three sections, left to right, with a divider between neighbours:
 * `navigate` (look and move around), `stage` (set the stage: make things) and `collaborate`.
 */
export const FLOATING_DOCK_SECTION_IDS = ['navigate', 'stage', 'collaborate'] as const;

/** One of {@link FLOATING_DOCK_SECTION_IDS}. */
export type FloatingDockSectionId = (typeof FLOATING_DOCK_SECTION_IDS)[number];

/** A floating dock tool: its name, key, what it makes active, and whether it has a panel. */
export interface FloatingDockToolDefinition {
  /** Its name: the button's accessible name and tooltip, before its shortcut. */
  readonly label: string;
  /** The single key that chooses it, in `mod+shift+z` notation (`v`). */
  readonly chord: string;
  /** Other keys that choose it too: Draw keeps the classic draw key Shift+P. */
  readonly otherChords?: readonly string[];
  /**
   * The interaction mode it makes active; none for Comment, whose placement is the site's comment
   * flow, and Reactions, whose flyout is the board's reactions.
   */
  readonly mode?: ToolId;
  /**
   * Whether choosing it opens its tool panel above the dock: only Shapes, Image,
   * Connector, Draw, Sticky and Reactions do; the others work straight away.
   */
  readonly hasPanel: boolean;
}

/** What a floating whiteboard calls a frame, and the words new frames' names start with. */
export const SECTION_NAME_PREFIX = 'Section';

/** Every floating dock tool's definition. */
export const FLOATING_DOCK_TOOLS: Readonly<Record<FloatingDockToolId, FloatingDockToolDefinition>> =
  {
    select: { label: 'Select', chord: 'v', mode: 'select', hasPanel: false },
    pan: { label: 'Pan', chord: 'h', mode: 'hand', hasPanel: false },
    section: { label: 'Section', chord: 'f', mode: 'frame', hasPanel: false },
    shapes: { label: 'Shapes', chord: 's', mode: 'shape', hasPanel: true },
    // No mode of its own: the image tool opens the picker at once; here its panel
    // offers Upload and From link instead.
    image: { label: 'Image', chord: 'i', hasPanel: true },
    text: { label: 'Text', chord: 't', mode: 'text', hasPanel: false },
    connector: { label: 'Connector', chord: 'c', mode: 'connector', hasPanel: true },
    draw: {
      label: 'Draw',
      chord: 'p',
      otherChords: ['shift+p'],
      mode: 'draw',
      hasPanel: true,
    },
    sticky: { label: 'Sticky note', chord: 'n', mode: 'sticky', hasPanel: true },
    comment: { label: 'Comment', chord: 'm', hasPanel: false },
    reactions: { label: 'Reactions', chord: 'e', hasPanel: true },
  };

/** A section of the floating dock: its id, its name for assistive technology, and its tools. */
export interface FloatingDockSection {
  /** The section. */
  readonly id: FloatingDockSectionId;
  /** Its name, the toolbar group's accessible name (`Navigate`). */
  readonly label: string;
  /** Its tools, left to right. */
  readonly tools: readonly FloatingDockToolId[];
}

/** The floating dock's sections for an editor, left to right (the design's three groups). */
export const FLOATING_DOCK_SECTIONS: readonly FloatingDockSection[] = [
  { id: 'navigate', label: 'Navigate', tools: ['select', 'pan', 'section'] },
  {
    id: 'stage',
    label: 'Set the stage',
    tools: ['shapes', 'image', 'text', 'connector', 'draw'],
  },
  { id: 'collaborate', label: 'Collaborate', tools: ['sticky', 'comment', 'reactions'] },
];

/**
 * The tools a role that cannot edit keeps: a commenter looks, pans, comments and
 * reacts; a viewer only looks and pans.
 */
export const FLOATING_READ_ONLY_TOOLS: Readonly<
  Record<Exclude<DockRole, 'editor'>, readonly FloatingDockToolId[]>
> = {
  commenter: ['select', 'pan', 'comment', 'reactions'],
  viewer: ['select', 'pan'],
};

/**
 * The floating dock's sections for a role, in order: every section for an editor; for anyone
 * else each section keeps only the role's {@link FLOATING_READ_ONLY_TOOLS}, and a section left
 * empty is dropped (so a viewer's dock is one section and no divider). Pure.
 *
 * @param role - Whose dock it is.
 * @returns The sections.
 */
export function floatingDockSectionsFor(role: DockRole): readonly FloatingDockSection[] {
  if (role === 'editor') return FLOATING_DOCK_SECTIONS;
  const kept = FLOATING_READ_ONLY_TOOLS[role];
  return FLOATING_DOCK_SECTIONS.map((section) => ({
    ...section,
    tools: section.tools.filter((tool) => kept.includes(tool)),
  })).filter((section) => section.tools.length > 0);
}

/**
 * The compact bottom bar's sections for a role (the same three groups as the dock),
 * without Pan: on a touch screen two fingers pan in every tool (as `MOBILE_BAR_LAYOUTS`). Pure.
 *
 * @param role - Whose bar it is.
 * @returns The sections, any left empty dropped.
 */
export function floatingMobileBarSectionsFor(role: DockRole): readonly FloatingDockSection[] {
  return floatingDockSectionsFor(role)
    .map((section) => ({ ...section, tools: section.tools.filter((tool) => tool !== 'pan') }))
    .filter((section) => section.tools.length > 0);
}

/**
 * The floating dock's tools for a role, flattened in order (the dock's Tab and arrow-key
 * order). Pure.
 *
 * @param role - Whose dock it is.
 * @returns The tools.
 */
export function floatingDockToolsFor(role: DockRole): readonly FloatingDockToolId[] {
  return floatingDockSectionsFor(role).flatMap((section) => section.tools);
}

/** Whether a floating dock tool can be used yet, and if not, which issue brings it. */
export type FloatingToolAvailability =
  | {
      /** It works: its button and its key choose it. */
      readonly isAvailable: true;
    }
  | {
      /** Not built yet: the button shows disabled, stays in the focus order and does nothing. */
      readonly isAvailable: false;
      /** The issue that brings it; never shown to the person. */
      readonly ticket: ToolTicket;
    };

const AVAILABLE: FloatingToolAvailability = { isAvailable: true };

/**
 * Each floating dock tool's availability for an editor: Reactions arrive with their transport;
 * a ticket enables its tool by changing its entry here, as Draw's did once the draw
 * tool and its strokes landed.
 */
export const FLOATING_TOOL_AVAILABILITY: Readonly<
  Record<FloatingDockToolId, FloatingToolAvailability>
> = {
  select: AVAILABLE,
  pan: AVAILABLE,
  section: AVAILABLE,
  shapes: AVAILABLE,
  image: AVAILABLE,
  text: AVAILABLE,
  connector: AVAILABLE,
  draw: AVAILABLE,
  sticky: AVAILABLE,
  comment: AVAILABLE,
  reactions: AVAILABLE,
};

/**
 * Whether a floating dock tool can be used by a role. An editor gets
 * {@link FLOATING_TOOL_AVAILABILITY}; another role the tools its dock holds (a commenter's Comment
 * among them since: pins are the comments service's, not the document's). Pure.
 *
 * @param tool - The tool.
 * @param role - Whose dock it is.
 * @returns Its availability; a tool the role's dock does not hold is unavailable.
 */
export function floatingToolAvailability(
  tool: FloatingDockToolId,
  role: DockRole,
): FloatingToolAvailability {
  const availability = FLOATING_TOOL_AVAILABILITY[tool];
  if (role === 'editor' || !availability.isAvailable) return availability;
  if (!FLOATING_READ_ONLY_TOOLS[role].includes(tool)) {
    return { isAvailable: false, ticket: 'no ticket yet' };
  }
  return availability;
}

/**
 * The floating dock tool that stands for an interaction mode, for showing the active tool
 * pressed: the first whose `mode` it is (`hand` is Pan, `frame` is Section). The line tool and
 * the vector pen have no floating dock tool (drops them from the whiteboard). Pure.
 *
 * @param mode - The active interaction mode.
 * @returns The tool, or `undefined`.
 */
export function floatingDockToolOfMode(mode: ToolId): FloatingDockToolId | undefined {
  return FLOATING_DOCK_TOOL_IDS.find((id) => FLOATING_DOCK_TOOLS[id].mode === mode);
}
