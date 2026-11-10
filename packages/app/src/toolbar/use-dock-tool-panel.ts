import { useEffect, useReducer } from 'react';

import { isEditableTarget } from '../focus/editable-target.js';
import { matchShortcut, type ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import {
  FLOATING_DOCK_TOOLS,
  floatingDockToolOfMode,
  type FloatingDockToolId,
} from '../state/floating-dock.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';
import {
  INITIAL_TOOL_PANEL_STATE,
  isToolPanelId,
  toolPanelReducer,
  type ToolPanelId,
  type ToolPanelState,
} from '../state/tool-panel-state.js';

import type { AnyToolPanel } from './tool-panels/tool-panel-contribution.js';
import {
  useToolPanelChoices,
  useToolPanelKeys,
  type ToolPanelChoices,
} from './tool-panels/use-tool-panel-choices.js';

/** The floating dock's tool panel: its state, the open panel's registration and its choices. */
export interface DockToolPanel {
  /** Which tool is chosen and which panel shows. */
  readonly state: ToolPanelState;
  /** The open panel, when one shows and is registered. */
  readonly open: AnyToolPanel | undefined;
  /** The panels' choices. */
  readonly choices: ToolPanelChoices;
  /**
   * A dock button was chosen: the chosen tool's button again shows or hides its panel; with a
   * modeless panel open (Image), another tool closes it or swaps it (the shell's active tool may
   * not change, so the sync on it would not).
   */
  readonly chooseFromButton: (tool: FloatingDockToolId) => void;
  /** The open panel's tool when it has no interaction mode (Image), shown pressed; else none. */
  readonly modeless: ToolPanelId | undefined;
  /** Closes the panel. */
  readonly close: () => void;
}

/**
 * The floating dock's tool panel: the panel of the tool the shell makes active opens
 * (by its button or its key), another tool closes it or swaps it, Escape anywhere closes it, and
 * the registered panels' choices are kept and given to their tools (`useToolPanelChoices`), and
 * a panel's keys change them (`useToolPanelKeys`).
 *
 * @param state - The shell state: the active tool, whether the person may edit.
 * @param dispatch - The shell's dispatch.
 * @param panels - The tool panels by tool.
 * @param registry - The shell's shortcuts: another tool's key closes a modeless panel.
 * @returns The panel's state and handlers.
 */
export function useToolPanel(
  state: ShellState,
  dispatch: (action: ShellAction) => void,
  panels: ReadonlyMap<ToolPanelId, AnyToolPanel>,
  registry: ShortcutRegistry<ShellAction>,
): DockToolPanel {
  const [panelState, panelDispatch] = useReducer(toolPanelReducer, INITIAL_TOOL_PANEL_STATE);
  const choices = useToolPanelChoices(panels, dispatch, state.canEdit);
  useToolPanelKeys(panels, choices, state.lastToolPanelKey);
  const active = floatingDockToolOfMode(state.activeTool) ?? 'select';
  useEffect(() => {
    panelDispatch(
      isToolPanelId(active)
        ? { type: 'choose', tool: active }
        : { type: 'toolChanged', tool: active },
    );
  }, [active]);
  // A modeless panel's tool (Image) opens by request: its button or key (`openToolPanel`).
  const request = state.toolPanelRequest;
  useEffect(() => {
    if (request !== undefined) panelDispatch({ type: 'choose', tool: request.panel });
  }, [request]);
  const modeless =
    panelState.openPanel !== null && FLOATING_DOCK_TOOLS[panelState.openPanel].mode === undefined
      ? panelState.openPanel
      : undefined;
  const isOpen = panelState.openPanel !== null;
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        panelDispatch({ type: 'escape' });
        return;
      }
      // Another tool's key closes a modeless panel, whose tool the shell's active tool is not;
      // typing in a field (the Image panel's link) is not a key.
      if (isEditableTarget(event.target)) return;
      const pressedTool = dockToolOfAction(matchShortcut(event, registry)?.action);
      if (modeless !== undefined && pressedTool !== undefined && pressedTool !== modeless) {
        panelDispatch({ type: 'toolChanged', tool: pressedTool });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, modeless, registry]);
  return {
    state: panelState,
    open: panelState.openPanel === null ? undefined : panels.get(panelState.openPanel),
    choices,
    modeless,
    chooseFromButton: (tool) => {
      const hasMode = FLOATING_DOCK_TOOLS[tool].mode !== undefined;
      if (hasMode && isToolPanelId(tool) && tool === panelState.tool) {
        panelDispatch({ type: 'choose', tool });
      } else if (modeless !== undefined && tool !== modeless && hasMode) {
        panelDispatch(
          isToolPanelId(tool) ? { type: 'choose', tool } : { type: 'toolChanged', tool },
        );
      }
    },
    close: () => {
      panelDispatch({ type: 'escape' });
    },
  };
}

/**
 * The floating dock tool a shortcut's action chooses: a mode's tool for `selectTool`, Comment for
 * the comment key; none for anything else.
 *
 * @param action - The action, if a shortcut was pressed.
 * @returns The tool, or `undefined`.
 */
function dockToolOfAction(action: ShellAction | undefined): FloatingDockToolId | undefined {
  if (action?.type === 'selectTool') return floatingDockToolOfMode(action.tool);
  return action?.type === 'toggleCommentPlacing' ? 'comment' : undefined;
}
