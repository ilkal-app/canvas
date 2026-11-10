import type { z } from 'zod';

import { rootOf } from '../history/undo-groups.js';
import type { TransactionOrigin } from '../origin/transaction-origin.js';
import type { DocumentStore } from '../store/document-store.js';
import { internalsOf } from '../store/internal.js';
import {
  RunStoppedError,
  StoreDestroyedError,
  type StoreBusyError,
  type StoreRun,
} from '../store/store-run.js';

import { commandError, type CommandError } from './command-error.js';
import type { Command } from './command.js';
import { planCommandInStages } from './preview-command.js';
import {
  completeRun,
  emptyChangeSet,
  planRun,
  type CommandEnvironment,
  type PlannedRun,
} from './run-command.js';
import {
  SteppedRun,
  stepsOf,
  type RunReport,
  type RunSteps,
  type StartRunOptions,
} from './stepped-run.js';
import { isWriteBudget } from './write-budget.js';

// A stepped run: a large command applied a part per browser task, so a 10k paste
// or delete never freezes the page for longer than one part. It is planned, validated and judged
// whole and at once, against one board, like `runCommand`; its first part is applied in the same
// task, before anything else can change the board; the store is held for it (`StoreRun`) until
// its last part, so no other writer, local or remote, joins its undo step or changes the board a
// later part was planned against. Page listeners hear each part in its own task. A staged plan
// (`isPlanStaged`) opens the run first and plans across tasks too, so a paste of thousands of
// objects is parsed and validated against the board its parts will land on, a stage at a time.

export type { RunReport, StartRunOptions } from './stepped-run.js';

/** A command `startRun` refused before writing anything, as `runCommand` refuses one. */
export interface CommandRefusal {
  /** Refused. */
  readonly status: 'rejected';
  /** Every problem found; never empty. */
  readonly errors: readonly CommandError[];
}

/**
 * A staged plan refused its command (`startRun` with `isPlanStaged`): nothing was written,
 * as a refusal of `runCommand` writes nothing.
 */
export class RunRefusedError extends Error {
  /** Every problem found; never empty. */
  readonly errors: readonly CommandError[];

  /**
   * Makes the error.
   *
   * @param errors - The problems.
   */
  constructor(errors: readonly CommandError[]) {
    super(`The change was refused: ${errors[0]?.message ?? 'invalid'}`);
    this.name = 'RunRefusedError';
    this.errors = errors;
  }
}

/**
 * Starts a stepped run of one command. Plans, validates and judges it as
 * `runCommand` does, then splits it into parts of at most `maxWrites` planned writes
 * (`Command.split`), opens a run on the store (`StoreRun`: every other mutation throws
 * `StoreBusyError` until it ends) and one undo step, and applies the first part, all in the
 * calling task. Each later part is applied after `yieldToBrowser`, in a transaction and a part
 * scope of its own: page listeners (`afterParts`) hear each part in its own task, outside the
 * run's authority, so they cannot write. A refusal is returned at once, as a value; an applied
 * command's promise resolves once its last part is in and the store is released. With
 * `isPlanStaged` the run is opened first and the planning itself is staged (`Command.planInStages`):
 * the first part then comes after yields, and a refusal rejects as `RunRefusedError`.
 *
 * @param store - The document, or a store that forwards to it (`forwardUndoSteps`).
 * @param origin - Who the change is attributed to.
 * @param command - The command.
 * @param input - Its input, before parsing.
 * @param environment - The clock and the id generator.
 * @param options - The write budget per part and how to yield.
 * @returns The refusal, or the run's report; it rejects with `RunStoppedError` when the run
 *   stopped before its last part (a part threw, a yield rejected, the store was destroyed), and,
 *   staged, with `RunRefusedError` or `StoreDestroyedError` while planning.
 * @throws {StoreBusyError} When another run holds the store.
 * @throws {Error} Inside a transaction or a store listener.
 */
export function startRun<InputSchema extends z.ZodType, Plan, Result>(
  store: DocumentStore,
  origin: TransactionOrigin,
  command: Command<InputSchema, Plan, Result>,
  input: z.input<InputSchema>,
  environment: CommandEnvironment,
  options: StartRunOptions,
): CommandRefusal | Promise<RunReport<Result>> {
  if (!isWriteBudget(options.maxWrites)) {
    const message = 'maxWrites must be a positive whole number';
    return { status: 'rejected', errors: [commandError('invalid-input', null, [], message)] };
  }
  if (options.isPlanStaged === true) {
    const storeRun = internalsOf(rootOf(store)).beginRun();
    return startStaged(store, origin, command, input, environment, options, storeRun);
  }
  const run = planRun(store, origin, command, input, environment, options);
  if (run.status === 'rejected') return run;
  // Split before the store is held, so a split that throws holds nothing.
  const parts = partsOf(command, run, options);
  const stepped = new SteppedRun(
    store,
    run,
    parts.steps,
    options,
    internalsOf(rootOf(store)).beginRun(),
  );
  return stepped.start(parts.split);
}

/**
 * A planned run's transactions (`Command.split`, then `stepsOf`), and the split's result.
 *
 * @param command - The command.
 * @param run - The planned run.
 * @param options - The budget per part.
 * @returns The steps, and the whole command's result when it split.
 */
function partsOf<InputSchema extends z.ZodType, Plan, Result>(
  command: Command<InputSchema, Plan, Result>,
  run: PlannedRun<Plan, Result>,
  options: StartRunOptions,
): { readonly steps: RunSteps<Plan>; readonly split: { readonly result: Result } | undefined } {
  const split = command.split?.(run.plan, { maxWrites: options.maxWrites });
  const [first = run.plan, ...rest] = split?.parts ?? [];
  const steps = stepsOf(run, first, rest, options.maxWrites);
  return { steps, split: split === undefined ? undefined : { result: split.result } };
}

/**
 * A staged run, its store already held: plans the command a stage at a time, then applies its
 * parts. Every way out before the first part closes the run; a stop or a rejected yield while
 * planning is a `RunStoppedError` with no part committed, never a refusal.
 *
 * @param store - The store written.
 * @param origin - Who the change is attributed to.
 * @param command - The command.
 * @param input - Its input, before parsing.
 * @param environment - The clock and the id generator.
 * @param options - The budget and the yield.
 * @param storeRun - The open run.
 * @returns The report.
 */
async function startStaged<InputSchema extends z.ZodType, Plan, Result>(
  store: DocumentStore,
  origin: TransactionOrigin,
  command: Command<InputSchema, Plan, Result>,
  input: z.input<InputSchema>,
  environment: CommandEnvironment,
  options: StartRunOptions,
  storeRun: StoreRun,
): Promise<RunReport<Result>> {
  const { runs } = internalsOf(rootOf(store));
  const stopped = (cause: unknown) => new RunStoppedError(0, emptyChangeSet(origin), cause);
  const stage = async (): Promise<void> => {
    try {
      await options.yieldToBrowser();
    } catch (error) {
      throw stopped(error);
    }
    if (runs.isDestroyed) throw new StoreDestroyedError();
    try {
      storeRun.checkStop();
    } catch (error) {
      throw stopped(error);
    }
  };
  let run: PlannedRun<Plan, Result>;
  let parts: ReturnType<typeof partsOf<InputSchema, Plan, Result>>;
  try {
    const planning = await planCommandInStages(store, origin, command, input, environment, stage);
    if (planning.status === 'rejected') throw new RunRefusedError(planning.errors);
    const completed = completeRun(store, origin, command, planning.planned, options);
    if (completed.status === 'rejected') throw new RunRefusedError(completed.errors);
    // The writes wait for a task of their own, and for a last look at a stop or a destroy.
    await stage();
    parts = partsOf(command, completed, options);
    storeRun.certify(planning.planned.validated ?? []);
    run = completed;
  } catch (error) {
    storeRun.close();
    throw error;
  }
  return new SteppedRun(store, run, parts.steps, options, storeRun).start(parts.split);
}
