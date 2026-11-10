import type { ReactElement } from 'react';

import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';

import { ToolPanelHost } from './tool-panels/tool-panel-host.js';
import type { DockToolPanel } from './use-dock-tool-panel.js';
import type { PanelKeyboardFocus } from './use-panel-keyboard-focus.js';

/**
 * The floating dock's open tool panel, if any: its choices kept by the dock, focus taken
 * when a key opened it, and Escape handing focus back to the dock button.
 *
 * @param props - The dock's panel and keyboard focus, the shortcuts, dispatch and the sheet flag.
 * @param props.panel - The dock's tool panel.
 * @param props.keys - How the panel takes and gives back the keyboard.
 * @param props.registry - The shell's shortcuts.
 * @param props.dispatch - The shell's dispatch.
 * @param props.isSheet - Whether it is a bottom sheet over the compact bar.
 * @returns The panel, or nothing when none is open.
 */
export function OpenToolPanel(props: {
  readonly panel: DockToolPanel;
  readonly keys: PanelKeyboardFocus;
  readonly registry: ShortcutRegistry<ShellAction>;
  readonly dispatch: (action: ShellAction) => void;
  readonly isSheet: boolean;
}): ReactElement | null {
  const { panel, keys } = props;
  const { open } = panel;
  if (open === undefined) return null;
  return (
    <ToolPanelHost
      panel={open}
      choices={panel.choices.choicesOf(open.id)}
      onChange={(choices) => {
        panel.choices.setChoices(open.id, choices);
      }}
      registry={props.registry}
      dispatch={props.dispatch}
      onEscape={() => {
        keys.returnToDock(open.id, panel.close);
      }}
      shouldTakeFocus={keys.focusPanel === open.id}
      onFocused={keys.panelFocused}
      isSheet={props.isSheet}
    />
  );
}
