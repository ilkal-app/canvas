import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';

/**
 * A button in the toolbar's action area, beside the tools: a view
 * toggle (the grid, snapping), a clipboard or arrangement shortcut. It dispatches
 * one `ShellAction`, the same as its shortcut, and shows its shortcut from the registry. A task
 * adds one by adding a file `toolbar/actions/<name>-action.ts` exporting it as `toolbarAction`;
 * the shell finds it (`DEFAULT_TOOLBAR_ACTIONS`) and no list is edited.
 */
export interface ToolbarAction {
  /** Unique id, kebab-case (`toggle-grid`). */
  readonly id: string;
  /** The button's name. */
  readonly label: string;
  /** Where it sits among the actions, lowest first; ties by id. */
  readonly order: number;
  /** What pressing it dispatches. */
  readonly action: ShellAction;
  /**
   * For a toggle, whether it shows pressed (`aria-pressed`) in a shell state; absent for a plain
   * button.
   */
  readonly isPressed?: (state: ShellState) => boolean;
}

/** An immutable set of toolbar actions, sorted by `order`, then `id`. */
export interface ToolbarActionRegistry {
  /** The actions. */
  readonly actions: readonly ToolbarAction[];
}

/**
 * An empty registry.
 *
 * @returns The registry.
 */
export function createToolbarActionRegistry(): ToolbarActionRegistry {
  return { actions: [] };
}

/**
 * Adds an action to a registry, returning a new registry; the input is never changed.
 *
 * @param registry - The registry.
 * @param action - The action.
 * @returns The registry with the action in its place.
 * @throws {Error} When an action with the same id is already registered.
 */
export function registerToolbarAction(
  registry: ToolbarActionRegistry,
  action: ToolbarAction,
): ToolbarActionRegistry {
  if (registry.actions.some((existing) => existing.id === action.id)) {
    throw new Error(`A toolbar action "${action.id}" is already registered.`);
  }
  const actions = [...registry.actions, action].sort(
    (first, second) => first.order - second.order || first.id.localeCompare(second.id),
  );
  return { actions };
}

/**
 * Tells whether a value has the shape of a {@link ToolbarAction}, for the action files the
 * shell collects.
 *
 * @param value - An export of an action file.
 * @returns True when it has an id, label, order and an action with a type.
 */
export function isToolbarAction(value: unknown): value is ToolbarAction {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Record<keyof ToolbarAction, unknown>>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.order === 'number' &&
    typeof candidate.action === 'object' &&
    candidate.action !== null &&
    (candidate.isPressed === undefined || typeof candidate.isPressed === 'function')
  );
}
