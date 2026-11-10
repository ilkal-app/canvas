import { collectContributions, type ContributionModules } from '../shell/contributions.js';

import {
  createToolbarActionRegistry,
  isToolbarAction,
  registerToolbarAction,
  type ToolbarAction,
  type ToolbarActionRegistry,
} from './toolbar-actions.js';

/**
 * Every action file of `toolbar/actions/`: a file named `<name>-action.ts` exporting its action
 * as `toolbarAction`. Vite resolves the pattern when it builds (and Vitest when it tests).
 */
const ACTION_MODULES: ContributionModules = import.meta.glob<Readonly<Record<string, unknown>>>(
  './actions/*-action.ts',
  { eager: true },
);

/** The toolbar actions the shell ships, found in `toolbar/actions/`, in path order. */
export const DEFAULT_TOOLBAR_ACTIONS: readonly ToolbarAction[] = collectContributions(
  ACTION_MODULES,
  'toolbarAction',
  isToolbarAction,
);

/**
 * A registry of {@link DEFAULT_TOOLBAR_ACTIONS}: what the shell's toolbar shows unless given
 * another.
 *
 * @returns The registry.
 * @throws {Error} When two action files use the same id.
 */
export function createDefaultToolbarActionRegistry(): ToolbarActionRegistry {
  return DEFAULT_TOOLBAR_ACTIONS.reduce(registerToolbarAction, createToolbarActionRegistry());
}
