import { useCallback, useEffect, useRef, useState } from 'react';

import type { ShellAction } from '../../state/shell-action.js';
import { loadToolPanelChoices, saveToolPanelChoices } from '../../state/tool-panel-choices.js';
import type { RecordedToolPanelKey } from '../../state/tool-panel-key.js';
import type { ToolPanelId } from '../../state/tool-panel-state.js';
import type { PreferenceStorage } from '../../state/view-preferences.js';

import type { AnyToolPanel } from './tool-panel-contribution.js';

/** Every panel's choices, and how to change one. */
export interface ToolPanelChoices {
  /** Each registered panel's choices. */
  readonly choicesOf: (id: ToolPanelId) => unknown;
  /** Changes a panel's choices: kept for the person and given to its tool. */
  readonly setChoices: (id: ToolPanelId, choices: unknown) => void;
}

/**
 * Sets a panel's tool style from its choices.
 *
 * @param panel - The panel.
 * @param choices - Its choices.
 * @param dispatch - The shell's dispatch.
 */
function applyToolStyle(
  panel: AnyToolPanel,
  choices: unknown,
  dispatch: (action: ShellAction) => void,
): void {
  if (panel.toolStyle === undefined) return;
  const { tool, style, isInkPick } = panel.toolStyle(choices);
  dispatch({
    type: 'setToolStyle',
    tool,
    style,
    ...(isInkPick === undefined ? {} : { isInkPick }),
  });
}

/**
 * The tool panels' choices: each panel's, as the person left them in this browser (any
 * board), given to its tool as the style of new objects on load, again once the person may edit
 * (a style set while they may not is refused), and on every change, which is kept for the next
 * visit too. Main thread.
 *
 * @param panels - The registered panels.
 * @param dispatch - The shell's dispatch.
 * @param canEdit - Whether the person may edit now.
 * @param storage - Where the choices are kept; the page's `localStorage` if absent.
 * @returns The choices and their setter.
 */
export function useToolPanelChoices(
  panels: ReadonlyMap<ToolPanelId, AnyToolPanel>,
  dispatch: (action: ShellAction) => void,
  canEdit: boolean,
  storage?: PreferenceStorage,
): ToolPanelChoices {
  const [choices, setAll] = useState<ReadonlyMap<ToolPanelId, unknown>>(
    () =>
      new Map(
        [...panels].map(([id, panel]) => [id, loadToolPanelChoices(panel.codec, storage)] as const),
      ),
  );
  // Seeded once the person may edit; later changes are applied as they are made (`setChoices`).
  const choicesRef = useRef(choices);
  choicesRef.current = choices;
  useEffect(() => {
    if (!canEdit) return;
    for (const [id, panel] of panels) applyToolStyle(panel, choicesRef.current.get(id), dispatch);
  }, [panels, dispatch, canEdit]);
  const setChoices = useCallback(
    (id: ToolPanelId, next: unknown) => {
      const panel = panels.get(id);
      if (panel === undefined) return;
      setAll((all) => new Map(all).set(id, next));
      saveToolPanelChoices(panel.codec, next, storage);
      applyToolStyle(panel, next, dispatch);
    },
    [panels, dispatch, storage],
  );
  const choicesOf = useCallback((id: ToolPanelId) => choices.get(id), [choices]);
  return { choicesOf, setChoices };
}

/**
 * Applies each new tool panel key the shell records (`ShellState.lastToolPanelKey`) to
 * its panel's choices through the panel's `onKey`, as its buttons change them (`setChoices`), so
 * the panel shows the change and the tool's style follows. A key recorded before this mounted,
 * or one the panel does not take, changes nothing. Main thread.
 *
 * @param panels - The registered panels.
 * @param choices - Their choices and setter (`useToolPanelChoices`).
 * @param lastKey - The latest key the shell recorded.
 */
export function useToolPanelKeys(
  panels: ReadonlyMap<ToolPanelId, AnyToolPanel>,
  choices: ToolPanelChoices,
  lastKey: RecordedToolPanelKey | undefined,
): void {
  const appliedRef = useRef(lastKey?.sequence);
  const { choicesOf, setChoices } = choices;
  useEffect(() => {
    if (lastKey === undefined || lastKey.sequence === appliedRef.current) return;
    appliedRef.current = lastKey.sequence;
    const next = panels.get(lastKey.tool)?.onKey?.(choicesOf(lastKey.tool), lastKey.key);
    if (next !== undefined) setChoices(lastKey.tool, next);
  }, [lastKey, panels, choicesOf, setChoices]);
}
