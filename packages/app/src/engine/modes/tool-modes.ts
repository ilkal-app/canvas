import type { ObjectType } from '@canvas/schema';
import type { ToolId } from '@canvas/tools';

import type { ToolRouter } from '../tool-router.js';

import { isToolModeEntry, type ToolModeEntry, type ToolModeServices } from './tool-mode-entry.js';

/** A folder's modules as `import.meta.glob(…, { eager: true })` returns them, by path. */
type ModeModules = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/**
 * Every file of `modes/` named `<tool>-mode.ts`, each exporting its registration as
 * `toolModeEntry`. Vite resolves the pattern when it builds (and Vitest when it tests).
 */
const TOOL_MODE_MODULES: ModeModules = import.meta.glob<Readonly<Record<string, unknown>>>(
  './*-mode.ts',
  { eager: true },
);

/**
 * The registrations of a folder's modules, in path order, checked: one mode per tool and per
 * activated object type.
 *
 * @param modules - The modules, by path.
 * @returns The registrations.
 * @throws {Error} When a module lacks a well-formed `toolModeEntry`, or two register the same
 *   tool or object type, so a misnamed or clashing file fails the unit tests.
 */
export function toolModesOf(modules: ModeModules): ToolModeEntry[] {
  const tools = new Set<ToolId>();
  const types = new Set<ObjectType>();
  return Object.keys(modules)
    .sort()
    .map((path) => {
      const entry = modules[path]?.toolModeEntry;
      if (!isToolModeEntry(entry)) throw new Error(`${path} must export a \`toolModeEntry\`.`);
      if (tools.has(entry.tool)) throw new Error(`Two modes register the ${entry.tool} tool.`);
      tools.add(entry.tool);
      for (const type of entry.activates) {
        if (types.has(type)) throw new Error(`Two modes activate ${type} objects.`);
        types.add(type);
      }
      return entry;
    });
}

/** The tool modes found in `modes/`: the text tool's today. */
export const TOOL_MODES: readonly ToolModeEntry[] = toolModesOf(TOOL_MODE_MODULES);

/**
 * Registers tool modes with a router: each tool's mode, and its activations by object type.
 *
 * @param router - The router.
 * @param services - What the modes work on.
 * @param entries - The registrations; {@link TOOL_MODES} unless given.
 */
export function registerToolModes(
  router: ToolRouter,
  services: ToolModeServices,
  entries: readonly ToolModeEntry[] = TOOL_MODES,
): void {
  for (const entry of entries) {
    router.registerToolMode(entry.tool, () => entry.create(services));
    const { activate } = entry;
    if (activate === undefined) continue;
    for (const type of entry.activates) {
      router.registerActivation(type, (activation, object) =>
        activate(services, activation, object),
      );
    }
  }
}
