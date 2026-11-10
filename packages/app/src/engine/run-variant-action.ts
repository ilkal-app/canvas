import {
  resetVariantPresetCommand,
  runCommand,
  setInstanceVariantCommand,
  setVariantAxesCommand,
  setVariantPresetCommand,
  type CommandEnvironment,
  type CommandOutcome,
  type DocumentStore,
  type TransactionOrigin,
} from '@canvas/document';

import type { VariantComponentAction } from '../state/variant-action.js';

/** Who runs a variant command, and how. */
export interface VariantActionContext {
  /** The actor. */
  readonly origin: TransactionOrigin;
  /** The clock and ids. */
  readonly environment: CommandEnvironment;
}

/**
 * Runs the inspector's variant-set command over the whole board, one document command
 * and so one undo step: an instance's choice, a main's axes, or a preset's records.
 *
 * @param board - The whole board: a main and its instances may be on other pages.
 * @param context - The actor and environment.
 * @param action - The command; the preview is the engine document's, not run here.
 * @returns The command's outcome, or undefined for the preview.
 */
export function runVariantAction(
  board: DocumentStore,
  context: VariantActionContext,
  action: VariantComponentAction,
): CommandOutcome<unknown> | undefined {
  const { origin, environment } = context;
  const { id } = action;
  switch (action.command) {
    case 'setVariant': {
      const input = { id, variant: { ...action.variant } };
      return runCommand(board, origin, setInstanceVariantCommand, input, environment);
    }
    case 'setVariantAxes': {
      const input = {
        componentId: id,
        axes:
          action.axes === null
            ? null
            : action.axes.map(({ name, values }) => ({ name, values: [...values] })),
        ...(action.renames === undefined
          ? {}
          : {
              renames: {
                ...(action.renames.axes === undefined ? {} : { axes: [...action.renames.axes] }),
                ...(action.renames.values === undefined
                  ? {}
                  : { values: [...action.renames.values] }),
              },
            }),
      };
      return runCommand(board, origin, setVariantAxesCommand, input, environment);
    }
    case 'setPreset': {
      const { axis, value, path, override } = action;
      const input = { componentId: id, axis, value, path, override };
      return runCommand(board, origin, setVariantPresetCommand, input, environment);
    }
    case 'resetPreset': {
      const input = {
        componentId: id,
        axis: action.axis,
        value: action.value,
        ...(action.path === undefined ? {} : { path: action.path }),
        ...(action.fields === undefined ? {} : { fields: [...action.fields] }),
      };
      return runCommand(board, origin, resetVariantPresetCommand, input, environment);
    }
    case 'previewPreset':
      return undefined;
  }
}
