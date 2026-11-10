import type { ToolId } from '@canvas/tools';

import { collectContributions, type ContributionModules } from '../shell/contributions.js';
import {
  isToolStyleDefaults,
  type ToolStyleDefaults,
  type ToolStyles,
} from '../state/tool-style.js';
import type { ToolStyle } from '../state/tool-style.js';

/**
 * Every file of `tool-styles/` named `<tool>-style.ts`, exporting its tool's defaults as
 * `toolStyleDefaults`. Vite resolves the pattern when it builds (and Vitest when it tests).
 */
const TOOL_STYLE_MODULES: ContributionModules = import.meta.glob<Readonly<Record<string, unknown>>>(
  './*-style.ts',
  { eager: true },
);

/**
 * The creation tools' defaults by tool.
 *
 * @param entries - The registered defaults.
 * @returns Each tool's style.
 * @throws {Error} When two files register the same tool.
 */
export function toolStylesOf(entries: readonly ToolStyleDefaults[]): ToolStyles {
  const styles: Partial<Record<ToolId, ToolStyle>> = {};
  for (const { tool, style } of entries) {
    if (styles[tool] !== undefined) {
      throw new Error(`Two files register the default style of the ${tool} tool.`);
    }
    styles[tool] = style;
  }
  return styles;
}

/** The creation tools' registered defaults, found in `tool-styles/`. */
export const DEFAULT_TOOL_STYLES: ToolStyles = toolStylesOf(
  collectContributions(TOOL_STYLE_MODULES, 'toolStyleDefaults', isToolStyleDefaults),
);
