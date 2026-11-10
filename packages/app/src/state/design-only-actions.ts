import type { ShellAction } from './shell-action.js';

/**
 * Whether an action belongs to the design tools only, so a whiteboard runs it from nowhere:
 * creating a component. Under the floating chrome the shortcuts leave it out
 * (`FLOATING_SHORTCUTS`), and the document makes nothing should it arrive another way
 * (`EngineDocumentOptions.hasDesignTools`). Pure.
 *
 * @param action - A shell action.
 * @returns True for Create component.
 */
export function isDesignOnlyAction(action: ShellAction): boolean {
  return action.type === 'arrange' && action.command === 'createComponent';
}
