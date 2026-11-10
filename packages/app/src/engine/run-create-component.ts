import {
  createComponentCommand,
  runCommand,
  type CommandError,
  type DocumentStore,
} from '@canvas/document';

import { nextComponentName } from './component-names.js';
import type { GroupingContext } from './run-grouping.js';

/** What {@link runCreateComponent} works on. */
export interface CreateComponentContext extends GroupingContext {
  /** The whole board, whose live mains the new main's name counts; `store` when absent. */
  readonly definitions?: DocumentStore | undefined;
}

/**
 * The sentence the shell shows when making a component is refused, from the command's errors.
 *
 * @param errors - The refusal.
 * @returns The sentence.
 */
function createRefusalOf(errors: readonly CommandError[]): string {
  if (errors.some(({ code }) => code === 'mixed-parents')) {
    return 'Only objects in the same frame or group can make a component.';
  }
  return `These objects cannot make a component: ${errors[0]?.message ?? 'the document refused'}.`;
}

/**
 * Create component from the shell (ruling 2: `mod+alt+k`, the context menu, the dock's
 * component button): one `createComponent` command, so one undo step, wrapping the selection in
 * a new main named "Component N" (`nextComponentName` over the whole board) and selecting it.
 * With nothing selected, or when the document refuses (objects with different parents, a
 * locked one), nothing is made and the shell is told why. Main thread.
 *
 * @param context - The document, the board, the origin, the select tool and the notice.
 */
export function runCreateComponent(context: CreateComponentContext): void {
  const { store, origin, environment, controller, onNotice } = context;
  const { ids } = controller.selection;
  if (ids.length === 0) {
    onNotice?.('Select objects to make a component.');
    return;
  }
  // Over the whole board: the selection may hold instances of mains on other pages.
  const board = context.definitions ?? store;
  const name = nextComponentName(board.read().objects.values());
  const input = { ids: [...ids], name };
  const outcome = runCommand(board, origin, createComponentCommand, input, environment);
  if (outcome.status === 'applied') controller.select([outcome.result.componentId]);
  else onNotice?.(createRefusalOf(outcome.errors));
}
