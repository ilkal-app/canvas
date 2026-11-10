import {
  commandError,
  deleteColorTokenCommand,
  renameColorTokenCommand,
  resetColorTokenCommand,
  runCommand,
  setColorTokenCommand,
  type CommandError,
  type CommandOutcome,
  type DocumentStore,
} from '@canvas/document';
import { tokenValuesOf, type Rgba } from '@canvas/schema';

import type { ColorTokenAction } from '../state/color-token-action.js';

import type { SelectionEditTarget } from './selection-arrange.js';

/** What {@link runColorTokenAction} works on. */
export interface ColorTokenActionContext extends SelectionEditTarget {
  /** The whole board, whose token table every page shares; `store` when absent. */
  readonly definitions?: DocumentStore | undefined;
  /** Receives the errors of a command the document refused. */
  readonly onCommandRefused: (errors: readonly CommandError[]) => void;
}

/**
 * Runs one command of the Board colours section on the whole board's token table:
 * `setColorToken` (create, or a token's name and values; or one mode's value, the name and other
 * value read from the board as the command runs), `renameColorToken`, `deleteColorToken` or
 * `resetColorToken`, each one transaction and one undo step. A refusal (a name another token has,
 * the 64 custom tokens, a token a collaborator deleted) writes nothing and is reported. Main
 * thread.
 *
 * @param context - The document, origin, environment and where refusals go.
 * @param action - The command.
 */
export function runColorTokenAction(
  context: ColorTokenActionContext,
  action: ColorTokenAction,
): void {
  const { origin, environment } = context;
  const store = context.definitions ?? context.store;
  let outcome: CommandOutcome<unknown>;
  switch (action.command) {
    case 'set': {
      // The commands' inputs are strict and JSON-shaped (agents send them too): plain arrays.
      const { name } = action;
      const light: Rgba = [...action.light];
      const dark: Rgba = [...action.dark];
      const input = { ...(action.id === undefined ? {} : { id: action.id }), name, light, dark };
      outcome = runCommand(store, origin, setColorTokenCommand, input, environment);
      break;
    }
    case 'setValue': {
      // Read now, not when the field was edited: a collaborator's change to the name or the
      // other mode since then is kept. Reading and writing are one synchronous step.
      const entry = store.readTokens().get(action.id);
      const values = tokenValuesOf(action.id, store.readTokens());
      if (values === undefined) {
        const message = `there is no colour token "${action.id}"`;
        context.onCommandRefused([commandError('missing-token', null, ['id'], message)]);
        return;
      }
      const light: Rgba = [...(action.mode === 'light' ? action.value : values.light)];
      const dark: Rgba = [...(action.mode === 'dark' ? action.value : values.dark)];
      const input = { id: action.id, name: entry?.name ?? action.id, light, dark };
      outcome = runCommand(store, origin, setColorTokenCommand, input, environment);
      break;
    }
    case 'rename':
      outcome = runCommand(
        store,
        origin,
        renameColorTokenCommand,
        { id: action.id, name: action.name },
        environment,
      );
      break;
    case 'delete':
      outcome = runCommand(store, origin, deleteColorTokenCommand, { id: action.id }, environment);
      break;
    case 'reset':
      outcome = runCommand(store, origin, resetColorTokenCommand, { id: action.id }, environment);
      break;
  }
  if (outcome.status === 'rejected') context.onCommandRefused(outcome.errors);
}
