import type { ComponentType } from 'react';

import type { ToolId } from '@canvas/tools';

import { collectContributions, type ContributionModules } from '../../shell/contributions.js';
import type { ShortcutRegistry } from '../../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../../state/shell-action.js';
import type { ToolPanelChoiceCodec } from '../../state/tool-panel-choices.js';
import type { ToolPanelKey } from '../../state/tool-panel-key.js';
import { TOOL_PANEL_IDS, type ToolPanelId } from '../../state/tool-panel-state.js';
import type { ToolStyle } from '../../state/tool-style.js';

/**
 * What a tool panel's contents get: the panel's choices, how to change them, and the
 * shell's shortcuts and dispatch for anything else.
 *
 * @template T - The panel's choices.
 */
export interface ToolPanelContentsProps<T> {
  /** The person's choices, as kept (`loadToolPanelChoices`). */
  readonly choices: T;
  /** Changes them: they are kept for the person and become the tool's style for new objects. */
  readonly onChange: (choices: T) => void;
  /** The shell's shortcuts. */
  readonly registry: ShortcutRegistry<ShellAction>;
  /** The shell's dispatch. */
  readonly dispatch: (action: ShellAction) => void;
}

/**
 * One tool panel, registered by a file `toolbar/tool-panels/<name>-panel.tsx` that
 * exports it as `toolPanel` (made with {@link defineToolPanel}): which floating dock tool's panel
 * it is, its accessible name, how its choices are kept, the tool style they give, and its
 * contents. A panel is added (Draw; Reactions) without editing the framework.
 *
 * @template T - The panel's choices.
 */
export interface ToolPanelContribution<T> {
  /** The dock tool whose panel it is. */
  readonly id: ToolPanelId;
  /** Its accessible name (`Shapes`). */
  readonly label: string;
  /** How its choices are kept per person. */
  readonly codec: ToolPanelChoiceCodec<T>;
  /**
   * The creation tool's style the choices give, which the shell's tool styles take on load and
   * on every change, so the next object placed uses them; none for a panel that styles nothing.
   * The style may hold the tool's own choices too (`ToolOnlyStyle`: the draw tool's eraser).
   * `isInkPick` says whether its colour is a chosen Ink (true), which new objects keep as `ink`
   * rather than taking a contrasting colour (`ShellState.pickedInk`), or a fixed colour (false).
   */
  readonly toolStyle?:
    | ((choices: T) => {
        readonly tool: ToolId;
        readonly style: ToolStyle;
        readonly isInkPick?: boolean;
      })
    | undefined;
  /**
   * What a key pressed while the tool is active does to the choices (the Draw panel's
   * P and E), the same change a button makes, so the panel shows it and the tool's style
   * follows; `undefined` for a key the panel does not take. None for a panel without keys.
   */
  readonly onKey?: ((choices: T, key: ToolPanelKey) => T | undefined) | undefined;
  /** What the panel shows. */
  readonly contents: ComponentType<ToolPanelContentsProps<T>>;
}

/** A registered panel, its choices' type erased so panels of any kind sit in one list. */
export type AnyToolPanel = ToolPanelContribution<unknown>;

/**
 * Makes a tool panel for the registry, keeping its choices' type inside it.
 *
 * @template T - The panel's choices.
 * @param panel - The panel.
 * @returns The panel, its choices' type erased.
 */
export function defineToolPanel<T>(panel: ToolPanelContribution<T>): AnyToolPanel {
  return panel as unknown as AnyToolPanel;
}

/**
 * Tells whether a value is a tool panel, for the files the registry collects.
 *
 * @param value - An export of a panel file.
 * @returns True for an object with a panel id, a label, a codec that parses and a component.
 */
export function isToolPanelContribution(value: unknown): value is AnyToolPanel {
  if (typeof value !== 'object' || value === null) return false;
  const { id, label, codec, contents } = value as Readonly<Record<string, unknown>>;
  return (
    typeof id === 'string' &&
    (TOOL_PANEL_IDS as readonly string[]).includes(id) &&
    typeof label === 'string' &&
    typeof codec === 'object' &&
    codec !== null &&
    typeof (codec as Readonly<Record<string, unknown>>).parse === 'function' &&
    // A component: a function, or the element type `memo` and `forwardRef` make (`$$typeof`).
    (typeof contents === 'function' ||
      (typeof contents === 'object' && contents !== null && '$$typeof' in contents))
  );
}

/**
 * Builds the registry of panels by tool, refusing two panels for one tool.
 *
 * @param panels - The panels.
 * @returns Each tool's panel.
 * @throws {Error} When two panels register the same tool.
 */
export function toolPanelsOf(
  panels: readonly AnyToolPanel[],
): ReadonlyMap<ToolPanelId, AnyToolPanel> {
  const byTool = new Map<ToolPanelId, AnyToolPanel>();
  for (const panel of panels) {
    if (byTool.has(panel.id)) throw new Error(`Two files register the ${panel.id} tool panel.`);
    byTool.set(panel.id, panel);
  }
  return byTool;
}

/** Every panel file of `toolbar/tool-panels/`; Vite resolves the pattern when it builds. */
const TOOL_PANEL_MODULES: ContributionModules = import.meta.glob<Readonly<Record<string, unknown>>>(
  './*-panel.tsx',
  { eager: true },
);

/** The registered tool panels by tool. A tool without one opens no panel. */
export const TOOL_PANELS: ReadonlyMap<ToolPanelId, AnyToolPanel> = toolPanelsOf(
  collectContributions(TOOL_PANEL_MODULES, 'toolPanel', isToolPanelContribution),
);
