import {
  FLOATING_DOCK_TOOLS,
  FLOATING_TOOL_AVAILABILITY,
  type FloatingDockToolId,
} from './floating-dock.js';
import type { ShellAction } from './shell-action.js';
import type { ToolPanelId } from './tool-panel-state.js';

/**
 * What choosing a floating dock tool dispatches, by its button or its key: its
 * interaction mode made active; for Comment the site's comment placement toggled; for
 * Reactions its flyout; for a panel tool without a mode (Image) its panel
 * opened; nothing for a tool not built yet. The button and the key share it, so the button's hint
 * is the key's (`actionHint` matches actions). Pure.
 *
 * @param tool - The tool.
 * @returns The action, or `undefined`.
 */
export function floatingDockToolAction(tool: FloatingDockToolId): ShellAction | undefined {
  if (!FLOATING_TOOL_AVAILABILITY[tool].isAvailable) return undefined;
  if (tool === 'comment') return { type: 'toggleCommentPlacing' };
  if (tool === 'reactions') return { type: 'toggleReactions' };
  const { mode, hasPanel } = FLOATING_DOCK_TOOLS[tool];
  if (mode !== undefined) return { type: 'selectTool', tool: mode };
  // A panel tool without a mode (Image) opens its panel.
  return hasPanel ? { type: 'openToolPanel', panel: tool as ToolPanelId } : undefined;
}

/**
 * What a floating dock tool's key dispatches under the floating chrome: the
 * tool's own action (`floatingDockToolAction`), but for Draw the panel's `cycle` key, which
 * chooses Draw while another tool is active and otherwise cycles the drawing sub-tools. The
 * button's hint is looked up by it; and Reactions' E, marked as its key, which while drawing
 * chooses the eraser instead (`useCommentKeyDispatch`). Pure.
 *
 * @param tool - The tool.
 * @returns The action, or `undefined` for a tool not built yet.
 */
export function floatingDockKeyAction(tool: FloatingDockToolId): ShellAction | undefined {
  if (tool === 'reactions') return { type: 'toggleReactions', isKey: true };
  const action = floatingDockToolAction(tool);
  if (tool !== 'draw' || action === undefined) return action;
  return { type: 'toolPanelKey', tool: 'draw', key: 'cycle', shouldChooseTool: true };
}

/** What Shift+E (and E while drawing) dispatch under the floating chrome: the eraser. */
export const DRAW_ERASER_KEY_ACTION: ShellAction = {
  type: 'toolPanelKey',
  tool: 'draw',
  key: 'eraser',
  shouldChooseTool: false,
};
