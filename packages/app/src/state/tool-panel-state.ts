import {
  FLOATING_DOCK_TOOL_IDS,
  FLOATING_DOCK_TOOLS,
  type FloatingDockToolId,
} from './floating-dock.js';

/**
 * The floating dock tools that have a tool panel, in dock order. Every other tool
 * (Select, Pan, Section, Text, Comment) works straight away and opens none.
 */
export const TOOL_PANEL_IDS = FLOATING_DOCK_TOOL_IDS.filter(
  (id): id is ToolPanelId => FLOATING_DOCK_TOOLS[id].hasPanel,
);

/** A floating dock tool with a panel: Shapes, Image, Connector, Draw, Sticky or Reactions. */
export type ToolPanelId = 'shapes' | 'image' | 'connector' | 'draw' | 'sticky' | 'reactions';

/**
 * Tells whether a floating dock tool has a tool panel.
 *
 * @param tool - The tool.
 * @returns True for the six tools of {@link TOOL_PANEL_IDS}.
 */
export function isToolPanelId(tool: FloatingDockToolId): tool is ToolPanelId {
  return FLOATING_DOCK_TOOLS[tool].hasPanel;
}

/**
 * Which tool panel shows above the floating dock, and which tool is chosen. At most one panel
 * shows; it is always the chosen tool's.
 */
export interface ToolPanelState {
  /** The floating dock tool shown pressed. */
  readonly tool: FloatingDockToolId;
  /** The panel showing, the chosen tool's, or `null` when none shows. */
  readonly openPanel: ToolPanelId | null;
}

/** The state before anything is chosen: Select, no panel. */
export const INITIAL_TOOL_PANEL_STATE: ToolPanelState = { tool: 'select', openPanel: null };

/** What happens to the dock's tool and panel. */
export type ToolPanelEvent =
  | {
      /**
       * A dock tool was chosen, by its button or its key. A tool with a panel opens it, replacing
       * any other panel; choosing the chosen tool again while its panel shows closes the panel
       * and keeps the tool; a tool without a panel closes any panel.
       */
      readonly type: 'choose';
      /** The tool. */
      readonly tool: FloatingDockToolId;
    }
  | {
      /** Escape: the panel closes and the tool stays; with no panel, nothing changes. */
      readonly type: 'escape';
    }
  | {
      /**
       * The active tool changed from outside the dock (a tool handed back to Select, the
       * harness, a role change): the panel closes unless the new tool is the chosen one.
       */
      readonly type: 'toolChanged';
      /** The tool now active. */
      readonly tool: FloatingDockToolId;
    };

/**
 * Applies a {@link ToolPanelEvent}. Pure: returns the same state object when nothing changes.
 *
 * @param state - The current state.
 * @param event - What happened.
 * @returns The next state.
 */
export function toolPanelReducer(state: ToolPanelState, event: ToolPanelEvent): ToolPanelState {
  switch (event.type) {
    case 'choose': {
      const { tool } = event;
      if (!isToolPanelId(tool)) {
        return state.tool === tool && state.openPanel === null ? state : { tool, openPanel: null };
      }
      if (state.tool === tool) return { tool, openPanel: state.openPanel === null ? tool : null };
      return { tool, openPanel: tool };
    }
    case 'escape':
      return state.openPanel === null ? state : { ...state, openPanel: null };
    case 'toolChanged':
      if (event.tool === state.tool) return state;
      return { tool: event.tool, openPanel: null };
  }
}

/**
 * Whether the active tool stays active after it places an object (ruling): while its
 * panel shows, yes, so the person places one sticky after another with the panel's choices;
 * with the panel closed (Escape), a tool keeps today's behaviour, handing back to Select where
 * it does now. Pure.
 *
 * @param state - The dock's state.
 * @returns True while the chosen tool's panel shows.
 */
export function keepsToolAfterPlacing(state: ToolPanelState): boolean {
  return state.openPanel !== null && state.openPanel === state.tool;
}
