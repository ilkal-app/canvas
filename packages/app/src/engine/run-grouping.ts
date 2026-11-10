import {
  groupCommand,
  runCommand,
  ungroupCommand,
  type CommandEnvironment,
  type CommandError,
  type DocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import type { SelectController } from '@canvas/tools';

/** What {@link runGrouping} works on. */
export interface GroupingContext {
  /** The document. */
  readonly store: DocumentStore;
  /** Who the command is attributed to. */
  readonly origin: TransactionOrigin;
  /** The command clock and id generator. */
  readonly environment: CommandEnvironment;
  /** The select tool: its selection is what is grouped, and it selects the result. */
  readonly controller: Pick<SelectController, 'selection' | 'select'>;
  /** Receives the sentence the shell shows when nothing was done. */
  readonly onNotice?: (message: string) => void;
}

/**
 * The sentence the shell shows when grouping is refused, from the command's errors.
 *
 * @param errors - The refusal.
 * @returns The sentence.
 */
function groupRefusalOf(errors: readonly CommandError[]): string {
  if (errors.some(({ code }) => code === 'mixed-parents')) {
    return 'Only objects in the same frame or group can be grouped.';
  }
  return `These objects cannot be grouped: ${errors[0]?.message ?? 'the document refused'}.`;
}

/**
 * Group and ungroup from the shell, each one command and so one undo step: `group` puts
 * the selection in a new group and selects it (the objects must share a parent; otherwise nothing
 * is grouped and the shell is told why), `ungroup` dissolves every selected group and selects what
 * they held. Main thread.
 *
 * @param command - `group` or `ungroup`.
 * @param context - The document, the origin, the environment, the select tool and the notice.
 */
export function runGrouping(command: 'group' | 'ungroup', context: GroupingContext): void {
  const { store, origin, environment, controller, onNotice } = context;
  const { ids } = controller.selection;
  if (command === 'group') {
    if (ids.length === 0) return;
    const outcome = runCommand(store, origin, groupCommand, { ids: [...ids] }, environment);
    if (outcome.status === 'applied') controller.select([outcome.result.groupId]);
    else onNotice?.(groupRefusalOf(outcome.errors));
    return;
  }
  const groups = ids.filter((id) => store.get(id)?.type === 'group');
  if (groups.length === 0) {
    if (ids.length > 0) onNotice?.('Nothing to ungroup: select a group.');
    return;
  }
  const outcome = runCommand(store, origin, ungroupCommand, { ids: groups }, environment);
  if (outcome.status === 'applied') controller.select(outcome.result.releasedIds);
  else onNotice?.(`These groups cannot be ungrouped: ${outcome.errors[0]?.message ?? ''}.`);
}
