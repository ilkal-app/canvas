import type { z } from 'zod';

import type { BoardObject, ObjectId, PrincipalId } from '@canvas/schema';

import { boundErrorsOf } from '../bound/bound-errors.js';
import { boxSourceOf, overlaySource } from '../bound/box-source.js';
import { worldBoundViolations } from '../bound/world-bound-check.js';
import { runAsOneStep } from '../history/undo-groups.js';
import type { TransactionOrigin } from '../origin/transaction-origin.js';
import type { ChangeSet, DocumentStore } from '../store/document-store.js';

import type { CommandError } from './command-error.js';
import type { BoardReader, Command } from './command.js';
import { componentWriteErrors } from './component-write-checks.js';
import { planCycleNormalization } from './cycle-normalization.js';
import { planCommand, recordWrites, relayoutOf, type PlannedCommand } from './preview-command.js';
import { commandStamps, StampingTransaction, type CommandStamps } from './stamping-transaction.js';

/** Options of {@link runCommand} beyond its environment. */
export interface RunCommandOptions {
  /**
   * The agents whose component mains an agent's command may remove objects under:
   * the agents of the writer's operator, as the relay knows them. Only a removal is widened;
   * edits, moves and new objects under another principal's main stay `not-own-main`, and so
   * does retiring the main itself. Absent: the writer's own mains only.
   */
  readonly removableUnder?: ReadonlySet<PrincipalId>;
}

/**
 * What a command run needs from outside the document, injected so that tests are deterministic
 * (frozen clock, seeded ids) and production passes the real thing.
 */
export interface CommandEnvironment {
  /** The current time, whole ms since the Unix epoch; read once per command run. */
  readonly clock: () => number;
  /** Makes a new, unused object id (`createRandomObjectId` in production). */
  readonly createId: () => ObjectId;
}

/** The outcome of {@link runCommand}. */
export type CommandOutcome<Result> =
  | {
      /** The command ran, as one transaction or, split by the command, several (one step). */
      readonly status: 'applied';
      /** What the command returned. */
      readonly result: Result;
      /**
       * What its transaction changed (all its transactions, in order). When it changed nothing
       * the store delivers no change set, and this one has empty lists.
       */
      readonly changes: ChangeSet;
    }
  | {
      /** The command was refused before its transaction started: nothing was written. */
      readonly status: 'rejected';
      /** Every problem found; never empty. */
      readonly errors: readonly CommandError[];
    };

/**
 * Judges what a planned command would write against the board's bound: records the result
 * of its `apply` (`recordWrites`) and compares every written object, and every descendant it
 * carries, before and after on the board (`worldBoundViolations`). A command that keeps every
 * object where it is on the board (`isPlacePreserving`: group, ungroup, delete) is not judged.
 *
 * @param board - The board before the command.
 * @param command - The command.
 * @param written - Its recorded validated writes.
 * @returns The errors that refuse it; empty when it keeps the bound.
 */
function worldBoundErrors<InputSchema extends z.ZodType, Plan, Result>(
  board: BoardReader,
  command: Command<InputSchema, Plan, Result>,
  written: ReadonlyMap<ObjectId, BoardObject | null>,
): CommandError[] {
  if (command.isPlacePreserving === true) return [];
  const before = boxSourceOf(board);
  return boundErrorsOf(
    worldBoundViolations(before, overlaySource(before, written), written.keys()),
  );
}

/**
 * Runs one command: parses the input, validates it against the board
 * as it is, judges its result against the board's bound (`worldBoundViolations`), and
 * only then applies the plan in one transaction carrying `origin`, stamping `updatedAt` with the
 * clock's time on every object the command wrote. A malformed or conflicting input, or a result
 * that would carry an object further past the bound, is rejected before the transaction starts,
 * so a rejected command writes nothing, and the board's encoded state is byte-identical
 * afterwards. A plan the command splits (`Command.split`: a paste of thousands of
 * objects) is applied part by part, a transaction each, all validated and judged together
 * beforehand and recorded by undo histories as one step of several parts (`runAsOneStep`).
 *
 * Validation reads the board through `store.get` and `store.references` only, so its cost
 * follows what the command touches, not the board size.
 *
 * @param store - The document to change.
 * @param origin - Who the change is attributed to (user, agent, undo, system).
 * @param command - The command, usually from `COMMANDS`.
 * @param input - The command's input, before parsing; agents' JSON is passed as is.
 * @param environment - The clock and the id generator.
 * @param options - Who else's component mains the writer may remove objects under.
 * @returns The result and the change set, or the errors.
 * @throws {RangeError} When `origin` is invalid or the clock returns something that is not a
 *   timestamp; these are the caller's bugs, not the input's.
 * @throws {Error} When called inside a transaction or a store listener.
 */
export function runCommand<InputSchema extends z.ZodType, Plan, Result>(
  store: DocumentStore,
  origin: TransactionOrigin,
  command: Command<InputSchema, Plan, Result>,
  input: z.input<InputSchema>,
  environment: CommandEnvironment,
  options: RunCommandOptions = {},
): CommandOutcome<Result> {
  const run = planRun(store, origin, command, input, environment, options);
  if (run.status === 'rejected') return run;
  const { context, plan } = run;
  const changeSets: ChangeSet[] = [];
  const split = command.split?.(plan);
  const [first, ...rest] = split?.parts ?? [];
  if (split === undefined || first === undefined) {
    const result = run.applyPart(store, changeSets, plan, { hasRoots: true, hasLayout: true });
    return { status: 'applied', result, changes: changeSets[0] ?? emptyChangeSet(context.origin) };
  }
  runAsOneStep(store, () => {
    run.applyPart(store, changeSets, first, { hasRoots: true, hasLayout: rest.length === 0 });
    rest.forEach((part, index) => {
      const hasLayout = index === rest.length - 1;
      run.applyPart(store, changeSets, part, { hasRoots: false, hasLayout });
    });
  });
  return { status: 'applied', result: split.result, changes: mergeChangeSets(changeSets, context) };
}

/** A command planned, validated and judged, ready to apply in one part or several (`planRun`). */
export interface PlannedRun<Plan, Result> {
  /** Planned. */
  readonly status: 'planned';
  /** The command's origin and time. */
  readonly context: { readonly origin: TransactionOrigin; readonly now: number };
  /** The validated plan, whole. */
  readonly plan: Plan;
  /** The cycle-normalized roots, written before the plan's objects. */
  readonly roots: readonly BoardObject[];
  /** The live auto-layout the plan calls for, written after it. */
  readonly layout: readonly BoardObject[];
  /** The plan's own writes, objects whole, as `recordWrites` recorded them: an upper bound. */
  readonly writtenObjects: number;
  /**
   * Applies the plan, or one part of it, in one transaction, the `updatedAt` stamps at the end.
   *
   * @param store - The store to write.
   * @param changeSets - Where the transaction's change set is recorded.
   * @param part - The plan or part.
   * @param extras - Whether the cycle-normalized roots go first, and the live auto-layout last.
   * @param extras.hasRoots - The roots first: the first part, or a plan applied whole.
   * @param extras.hasLayout - The auto-layout last: the last part, or a plan applied whole.
   * @param onWritten - Told the planned writes the transaction made, once `apply` returned.
   * @returns What `apply` returned.
   */
  readonly applyPart: (
    store: DocumentStore,
    changeSets: ChangeSet[],
    part: Plan,
    extras: { readonly hasRoots: boolean; readonly hasLayout: boolean },
    onWritten?: (writes: number) => void,
  ) => Result;
  /**
   * Writes some of the roots or the auto-layout alone, in one transaction (a stepped
   * run's leading or trailing parts, when they do not fit its parts' budget).
   *
   * @param store - The store to write.
   * @param changeSets - Where the transaction's change set is recorded.
   * @param objects - The objects, whole.
   * @param onWritten - Told the planned writes the transaction made.
   */
  readonly applyObjects: (
    store: DocumentStore,
    changeSets: ChangeSet[],
    objects: readonly BoardObject[],
    onWritten?: (writes: number) => void,
  ) => void;
}

/**
 * Plans a command run, as `runCommand` and `startRun` begin one: parses and validates
 * the input, records the plan's writes with the auto-layout they call for, checks component
 * writes, cycle normalization and the board's bound. Reads only.
 *
 * @param store - The document.
 * @param origin - Who the change is attributed to.
 * @param command - The command.
 * @param input - Its input, before parsing.
 * @param environment - The clock and the id generator.
 * @param options - Who else's component mains the writer may remove objects under.
 * @returns The planned run, or the refusal.
 */
export function planRun<InputSchema extends z.ZodType, Plan, Result>(
  store: DocumentStore,
  origin: TransactionOrigin,
  command: Command<InputSchema, Plan, Result>,
  input: z.input<InputSchema>,
  environment: CommandEnvironment,
  options: RunCommandOptions = {},
):
  | PlannedRun<Plan, Result>
  | { readonly status: 'rejected'; readonly errors: readonly CommandError[] } {
  const planning = planCommand(store, origin, command, input, environment);
  if (planning.status === 'rejected') return planning;
  return completeRun(store, origin, command, planning.planned, options);
}

/**
 * The rest of {@link planRun} once the command is planned: its writes recorded, the auto-layout
 * they call for, and the components, cycles and bound judged over all of them.
 *
 * @param store - The document.
 * @param origin - Who the change is attributed to.
 * @param command - The command.
 * @param planned - Its parsed input, context and plan.
 * @param options - What the run may also remove.
 * @returns The run, or the errors that refuse it.
 */
export function completeRun<InputSchema extends z.ZodType, Plan, Result>(
  store: DocumentStore,
  origin: TransactionOrigin,
  command: Command<InputSchema, Plan, Result>,
  planned: PlannedCommand<z.output<InputSchema>, Plan>,
  options: RunCommandOptions = {},
):
  | PlannedRun<Plan, Result>
  | { readonly status: 'rejected'; readonly errors: readonly CommandError[] } {
  const recorded = recordWrites(command, planned);
  // The live auto-layout the writes call for is written with them and judged with them.
  const relayout = relayoutOf(store, recorded);
  const written = relayout.size === 0 ? recorded : new Map([...recorded, ...relayout]);
  const componentErrors = componentWriteErrors(store, written, origin, options.removableUnder);
  if (componentErrors.length > 0) return { status: 'rejected', errors: componentErrors };
  const normalization = planCycleNormalization(store, written);
  if (normalization.errors.length > 0) return { status: 'rejected', errors: normalization.errors };
  const boundErrors = worldBoundErrors(store, command, written);
  if (boundErrors.length > 0) return { status: 'rejected', errors: boundErrors };
  const { context } = planned;
  const layout = [...relayout.values()];
  // What decides the command's stamps, across its transactions (`StampingTransaction`).
  const stamps = commandStamps();
  return {
    status: 'planned',
    context,
    plan: planned.plan,
    roots: normalization.roots,
    layout,
    writtenObjects: recorded.size,
    // The cycle normalization and the bound were judged over the whole plan: the roots are
    // written once, before its objects.
    applyPart: (target, changeSets, part, { hasRoots, hasLayout }, onWritten) =>
      applyInTransaction(
        target,
        context,
        changeSets,
        hasRoots ? normalization.roots : [],
        (stamping) => {
          const result = command.apply(stamping, planned.input, part);
          if (hasLayout) for (const object of layout) stamping.setObject(object);
          return result;
        },
        { onWritten, stamps },
      ),
    applyObjects: (target, changeSets, objects, onWritten) => {
      applyInTransaction(target, context, changeSets, objects, () => undefined, {
        onWritten,
        stamps,
      });
    },
  };
}

/**
 * Applies a command's plan, or one part of it, in one transaction carrying the command's origin:
 * writes the cycle-normalized roots first, then the plan, then stamps `updatedAt` on
 * everything written; records the transaction's local change set.
 *
 * @param store - The document.
 * @param context - The command's origin and time.
 * @param context.origin - The origin.
 * @param context.now - The command's time, ms since the epoch.
 * @param changeSets - Where the transaction's change set is recorded.
 * @param roots - The normalized roots to write first; empty after the first part.
 * @param apply - Writes the plan or part.
 * @param options - Told the planned writes the transaction made (`write-budget.ts`) once
 *   `apply` returned and the stamps were written; what decides the command's stamps, shared by
 *   its transactions.
 * @param options.onWritten - Told the planned writes.
 * @param options.stamps - The command's stamp record (`commandStamps`).
 * @returns What `apply` returned.
 */
function applyInTransaction<Result>(
  store: DocumentStore,
  context: { readonly origin: TransactionOrigin; readonly now: number },
  changeSets: ChangeSet[],
  roots: readonly BoardObject[],
  apply: (transaction: StampingTransaction) => Result,
  options: {
    readonly onWritten?: ((writes: number) => void) | undefined;
    readonly stamps?: CommandStamps;
  } = {},
): Result {
  let changes: ChangeSet | undefined;
  const stopListening = store.subscribe((changeSet) => {
    if (changeSet.isLocal) changes ??= changeSet;
  });
  try {
    return store.transact(context.origin, (transaction) => {
      const stamping = new StampingTransaction(transaction, options.stamps);
      for (const root of roots) stamping.setObject(root);
      const applied = apply(stamping);
      stamping.stamp(context.now);
      options.onWritten?.(stamping.plannedWrites);
      return applied;
    });
  } finally {
    stopListening();
    if (changes !== undefined) changeSets.push(changes);
  }
}

/**
 * The change set of a command applied in several transactions: their lists joined in order,
 * each id once.
 *
 * @param changeSets - Each transaction's change set, in order.
 * @param context - The command's context, for its origin.
 * @param context.origin - The command's origin.
 * @returns A frozen change set.
 */
export function mergeChangeSets(
  changeSets: readonly ChangeSet[],
  context: { readonly origin: TransactionOrigin },
): ChangeSet {
  const joined = (pick: (changeSet: ChangeSet) => readonly ObjectId[]): readonly ObjectId[] =>
    Object.freeze([...new Set(changeSets.flatMap(pick))]);
  const pages = [...new Set(changeSets.flatMap((changeSet) => changeSet.pages ?? []))].sort();
  return Object.freeze({
    origin: changeSets[0]?.origin ?? context.origin,
    isLocal: true,
    created: joined((changeSet) => changeSet.created),
    updated: joined((changeSet) => changeSet.updated),
    deleted: joined((changeSet) => changeSet.deleted),
    ...(pages.length === 0 ? {} : { pages: Object.freeze(pages) }),
  });
}

/**
 * The change set of a transaction that changed nothing.
 *
 * @param origin - The transaction's origin.
 * @returns A frozen change set with empty lists.
 */
export function emptyChangeSet(origin: TransactionOrigin): ChangeSet {
  return Object.freeze({
    origin,
    isLocal: true,
    created: Object.freeze([]),
    updated: Object.freeze([]),
    deleted: Object.freeze([]),
  });
}
