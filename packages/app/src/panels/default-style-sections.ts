import { collectContributions, type ContributionModules } from '../shell/contributions.js';

import {
  createStylePanelRegistry,
  isStylePanelSection,
  registerStylePanelSection,
  type StylePanelRegistry,
  type StylePanelSection,
} from './panel-sections.js';

/**
 * Every section file of `panels/sections/`: a file named `<name>-section.tsx` exporting its
 * section as `stylePanelSection`. Vite resolves the pattern when it builds (and Vitest when it
 * tests), so adding a file is all it takes.
 */
const SECTION_MODULES: ContributionModules = import.meta.glob<Readonly<Record<string, unknown>>>(
  './sections/*-section.tsx',
  {
    eager: true,
  },
);

/** The style panel sections the shell ships, found in `panels/sections/`, in path order. */
export const DEFAULT_STYLE_PANEL_SECTIONS: readonly StylePanelSection[] = collectContributions(
  SECTION_MODULES,
  'stylePanelSection',
  isStylePanelSection,
);

/**
 * A registry of {@link DEFAULT_STYLE_PANEL_SECTIONS}, each added with
 * `registerStylePanelSection`: what the shell's style panel shows unless given another.
 *
 * @returns The registry.
 * @throws {Error} When two section files use the same id.
 */
export function createDefaultStylePanelRegistry(): StylePanelRegistry {
  return DEFAULT_STYLE_PANEL_SECTIONS.reduce(registerStylePanelSection, createStylePanelRegistry());
}
