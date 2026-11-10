import {
  RunRefusedError,
  RunStoppedError,
  StoreDestroyedError,
  startRun,
  type CommandError,
  type RunReport,
} from '@canvas/document';

import { refusalNotice } from '../notices/refusal-notice.js';

import { reportFault } from './engine-host-mount-options.js';
import { yieldToRendering } from './yield-to-rendering.js';

/**
 * The most planned writes in one part of a stepped command, tuned on the m1-mini's
 * production build: 500 deletes, or 250 objects created, keep a part's task (and the undo or redo
 * of it, which restores the parts as written) well under the 100 ms freeze budget, with room for
 * the first part's task, which also plans the whole command.
 */
export const STEPPED_MAX_WRITES = 500;

/**
 * The notice shown when a stepped change stopped before its last part and how many parts it had
 * is not known: it stopped while still planning.
 */
export const STOPPED_NOTICE = 'That change stopped partway: some of it was applied.';

/**
 * The notice of a stepped change that stopped before its last part: how many of its
 * parts were applied, when it got as far as planning them.
 *
 * @param error - What the run rejected with.
 * @returns A sentence for the person.
 */
export function stoppedNotice(error: RunStoppedError): string {
  const { committedParts, plannedParts } = error;
  if (plannedParts === undefined) return STOPPED_NOTICE;
  return `That change stopped partway: ${String(committedParts)} of ${String(plannedParts)} parts were applied.`;
}

/**
 * Whether a change of some objects plans in stages (`StartRunOptions.isPlanStaged`):
 * one of more objects than a part writes, whose planning then takes a task of its own, before its
 * first part. A smaller one stays as it was, planned and written in the calling task.
 *
 * @param objects - How many objects it names.
 * @returns The staging option.
 */
export function stagingFor(objects: number): { readonly isPlanStaged: boolean } {
  return { isPlanStaged: objects > STEPPED_MAX_WRITES };
}

/** What `startRun` takes, for any command: the app holds no command's input schema type. */
type StartArgs = Parameters<typeof startRun>;

/** Who hears how a stepped command went (`runStepped`); each is optional. */
export interface SteppedHandlers {
  /** Hears a refusal: nothing was written. */
  readonly onRefused?: (errors: readonly CommandError[]) => void;
  /** Hears the finished run: every part committed. */
  readonly onDone?: (report: RunReport<unknown>) => void;
  /** Shows the person a notice: the run stopped partway. */
  readonly onNotice?: (message: string) => void;
  /**
   * Hears a run that stopped partway, in place of the notice: a caller that can say more (a
   * paste counts its objects).
   */
  readonly onStopped?: (error: RunStoppedError) => void;
  /** Hears an unexpected failure; the mount's fault reporter when absent. */
  readonly onFault?: (error: Error) => void;
}

/**
 * Runs a large command a part per browser task (`startRun`): the store held
 * meanwhile, so the person's input waits (`DocumentInputQueue`) and the busy indicator shows, one
 * undo step all the same. A plan of one part applies at once; a refusal writes nothing and is
 * told at once. A run that stops partway keeps what it committed, one undo step, and says so.
 *
 * @param store - The document.
 * @param origin - Who the command is attributed to.
 * @param command - The command.
 * @param input - Its input.
 * @param environment - The clock and id generator.
 * @param handlers - Who hears how it went.
 * @param staging - Whether to plan the command in stages too (`StartRunOptions.isPlanStaged`):
 *   its refusal then comes after yields, to `onRefused` all the same.
 * @param staging.isPlanStaged - Plan in stages.
 */
export function runStepped(
  store: StartArgs[0],
  origin: StartArgs[1],
  command: StartArgs[2],
  input: StartArgs[3],
  environment: StartArgs[4],
  handlers: SteppedHandlers = {},
  staging: { readonly isPlanStaged?: boolean } = {},
): void {
  // Each part after a painted frame: a yield the browser need not render in (`scheduler.yield`)
  // let parts run back to back, one frame holding several, until it forced a paint near 100 ms.
  const options = { maxWrites: STEPPED_MAX_WRITES, yieldToBrowser: yieldToRendering, ...staging };
  const started = startRun(store, origin, command, input, environment, options);
  if (!(started instanceof Promise)) {
    handlers.onRefused?.(started.errors);
    return;
  }
  started.then(
    (report) => handlers.onDone?.(report),
    (error: unknown) => {
      if (error instanceof RunRefusedError) handlers.onRefused?.(error.errors);
      else stoppedOrFault(error, handlers);
    },
  );
}

/**
 * Handlers that tell the person everything as a notice: a refusal's first problem, or a stop.
 *
 * @param notify - Shows a notice.
 * @returns The handlers.
 */
export function noticeHandlers(notify: (message: string) => void): SteppedHandlers {
  return {
    onRefused: (errors) => {
      notify(refusalNotice(errors));
    },
    onNotice: notify,
  };
}

/**
 * Tells how a stepped change failed: partway (`onStopped`, else a notice), or unexpectedly (a
 * fault). A store destroyed under it, as its page closed, is told to no one.
 *
 * @param error - What it rejected with.
 * @param handlers - Who hears it.
 */
export function stoppedOrFault(
  error: unknown,
  handlers: Pick<SteppedHandlers, 'onNotice' | 'onFault' | 'onStopped'>,
): void {
  if (error instanceof RunStoppedError) {
    if (handlers.onStopped === undefined) handlers.onNotice?.(stoppedNotice(error));
    else handlers.onStopped(error);
    return;
  }
  if (error instanceof StoreDestroyedError) return;
  (handlers.onFault ?? reportFault)(error instanceof Error ? error : new Error(String(error)));
}
