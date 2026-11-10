import type { z } from 'zod';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { boxSourceOf, overlaySource } from '../bound/box-source.js';
import { RecordingTransaction } from '../bound/recording-transaction.js';
import { planRelayout } from '../layout/plan-relayout.js';
import { parseTransactionOrigin, type TransactionOrigin } from '../origin/transaction-origin.js';
import { validateObject } from '../store/object-validation.js';

import { errorsFromIssues, type CommandError } from './command-error.js';
import type { BoardReader, Command, CommandContext } from './command.js';
import type { CommandEnvironment } from './run-command.js';

/** A command parsed and validated against the board, ready to apply. */
export interface PlannedCommand<Input, Plan> {
  /** The parsed input. */
  readonly input: Input;
  /** The run's context: board, origin, time, id generator. */
  readonly context: CommandContext;
  /** What `validate` returned. */
  readonly plan: Plan;
  /** The plan's new objects already validated as the store validates them (`planInStages`). */
  readonly validated?: readonly BoardObject[];
}

/** The outcome of {@link planCommand}. */
export type CommandPlanning<Input, Plan> =
  | { readonly status: 'planned'; readonly planned: PlannedCommand<Input, Plan> }
  | { readonly status: 'rejected'; readonly errors: readonly CommandError[] };

/**
 * Reads the clock and checks the time is a timestamp the schema accepts.
 *
 * @param clock - The injected clock.
 * @returns The time, ms since the Unix epoch.
 * @throws {RangeError} When the clock returns anything but a non-negative safe integer.
 */
function readClock(clock: () => number): number {
  const now = clock();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new RangeError(`The command clock returned ${String(now)}, not whole ms since 1970`);
  }
  return now;
}

/**
 * The first two steps of a command run (`runCommand`): parses the input and validates it against
 * the board, which computes the plan. Writes nothing.
 *
 * @param board - The board before the command.
 * @param origin - Who the change is attributed to.
 * @param command - The command.
 * @param input - Its input, before parsing.
 * @param environment - The clock and the id generator.
 * @returns The planned command, or the errors that refuse it.
 * @throws {RangeError} When `origin` is invalid or the clock returns something that is not a
 *   timestamp.
 */
export function planCommand<InputSchema extends z.ZodType, Plan, Result>(
  board: BoardReader,
  origin: TransactionOrigin,
  command: Command<InputSchema, Plan, Result>,
  input: unknown,
  environment: CommandEnvironment,
): CommandPlanning<z.output<InputSchema>, Plan> {
  const validOrigin = parseTransactionOrigin(origin);
  const parsed = command.input.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'rejected',
      errors: errorsFromIssues('invalid-input', null, parsed.error.issues),
    };
  }
  const context: CommandContext = {
    board,
    origin: validOrigin,
    now: readClock(environment.clock),
    createId: environment.createId,
  };
  const validation = command.validate(context, parsed.data);
  if (!validation.isValid) return { status: 'rejected', errors: validation.errors };
  return { status: 'planned', planned: { input: parsed.data, context, plan: validation.plan } };
}

/**
 * {@link planCommand} in stages: the command's `planInStages` when it has one, else its
 * parse and `validate` in one stage. Same plan, same refusals.
 *
 * @param board - The board before the command.
 * @param origin - Who the change is attributed to.
 * @param command - The command.
 * @param input - Its input, before parsing.
 * @param environment - The clock and the id generator.
 * @param stage - Awaited between two stages; it rejects when planning is to stop.
 * @returns The planned command, or the errors that refuse it.
 * @throws {RangeError} When `origin` is invalid or the clock returns something that is not a
 *   timestamp.
 */
export async function planCommandInStages<InputSchema extends z.ZodType, Plan, Result>(
  board: BoardReader,
  origin: TransactionOrigin,
  command: Command<InputSchema, Plan, Result>,
  input: unknown,
  environment: CommandEnvironment,
  stage: () => Promise<void>,
): Promise<CommandPlanning<z.output<InputSchema>, Plan>> {
  if (command.planInStages === undefined) {
    return planCommand(board, origin, command, input, environment);
  }
  const context: CommandContext = {
    board,
    origin: parseTransactionOrigin(origin),
    now: readClock(environment.clock),
    createId: environment.createId,
  };
  const staged = await command.planInStages(context, input, stage);
  if (!staged.isValid) return { status: 'rejected', errors: staged.errors };
  const { input: parsed, plan, validated } = staged;
  const planned = {
    input: parsed,
    context,
    plan,
    ...(validated === undefined ? {} : { validated }),
  };
  return { status: 'planned', planned };
}

/**
 * What a planned command's `apply` would write, recorded without writing (`RecordingTransaction`).
 *
 * @param command - The command.
 * @param planned - Its parsed input, context and plan.
 * @returns Each object it would write, whole, by id; `null` for one it would delete.
 */
export function recordWrites<InputSchema extends z.ZodType, Plan, Result>(
  command: Command<InputSchema, Plan, Result>,
  planned: PlannedCommand<z.output<InputSchema>, Plan>,
): ReadonlyMap<ObjectId, BoardObject | null> {
  const recording = new RecordingTransaction(planned.context.board, planned.context.origin);
  command.apply(recording, planned.input, planned.plan);
  return recording.written;
}

/**
 * The live auto-layout a command's writes call for: `planRelayout` over the board the
 * command would leave, from what it writes and the parents those objects had.
 *
 * @param store - The board before the command.
 * @param written - The command's recorded writes.
 * @returns The objects the layout changes and the store would accept; empty when no auto-layout
 *   container is reached.
 */
export function relayoutOf(
  store: BoardReader,
  written: ReadonlyMap<ObjectId, BoardObject | null>,
): Map<ObjectId, BoardObject> {
  const touched = new Set<ObjectId>(written.keys());
  for (const id of written.keys()) {
    const parentBefore = store.get(id)?.parentId;
    if (parentBefore != null) touched.add(parentBefore);
  }
  const overlay = overlaySource(boxSourceOf(store), written);
  const planned = planRelayout(
    { ...overlay, instancesOf: (mainId) => store.references.instancesOf(mainId) },
    touched,
  );
  // A size the store would refuse (a hugging container past the extent a renderer draws, after a
  // peer's raw write) is left out: that object keeps what it has, and the command still applies.
  for (const [id, object] of planned) {
    if (!validateObject(object, store.get(id)).isValid) planned.delete(id);
  }
  return planned;
}

/** The outcome of {@link previewCommand}. */
export type CommandPreview =
  | {
      /** The command validates; nothing was written. */
      readonly status: 'planned';
      /** Each object it would write, whole, by id; `null` for one it would delete. */
      readonly written: ReadonlyMap<ObjectId, BoardObject | null>;
    }
  | {
      /** The command's input or its validation refuses it. */
      readonly status: 'rejected';
      /** Every problem found; never empty. */
      readonly errors: readonly CommandError[];
    };

/**
 * What a command would leave on the board, without writing anything: parses the input,
 * validates it, and records what `apply` would write. The board's bound is not judged, so a
 * caller can judge the result itself: the sync fuzz's model of the bound compares each written
 * object's box on the board before and after (`worldBoxOf`, `overlaySource`). `runCommand` refuses
 * exactly the commands whose recorded result breaks the bound (`worldBoundViolations`), unless
 * the command keeps every object's place (`isPlacePreserving`).
 *
 * @param board - The board the command would run on.
 * @param origin - Who the change would be attributed to.
 * @param command - The command, usually from `COMMANDS`.
 * @param input - Its input, before parsing.
 * @param environment - The clock and an id generator; `validate` draws the new ids from it.
 * @returns What it would write, or the errors that refuse it before the bound.
 * @throws {RangeError} When `origin` is invalid or the clock returns something that is not a
 *   timestamp.
 */
export function previewCommand<InputSchema extends z.ZodType, Plan, Result>(
  board: BoardReader,
  origin: TransactionOrigin,
  command: Command<InputSchema, Plan, Result>,
  input: unknown,
  environment: CommandEnvironment,
): CommandPreview {
  const planning = planCommand(board, origin, command, input, environment);
  if (planning.status === 'rejected') return planning;
  const recorded = recordWrites(command, planning.planned);
  const relayout = relayoutOf(board, recorded);
  return {
    status: 'planned',
    written: relayout.size === 0 ? recorded : new Map([...recorded, ...relayout]),
  };
}
