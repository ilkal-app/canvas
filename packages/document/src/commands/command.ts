import type { z } from 'zod';

import type { BoardObject, ObjectId, PageId } from '@canvas/schema';

import type { BoardTimerView } from '../facilitation/board-timer-events.js';
import type { TransactionOrigin } from '../origin/transaction-origin.js';
import type { DocumentStore, DocumentTransaction } from '../store/document-store.js';

import type { CommandError } from './command-error.js';

/**
 * What a command reads while it validates: the board as of the last completed transaction,
 * one object at a time and through the reverse indexes. Whole-board restore additionally needs
 * the optional snapshot reader to find objects absent from the historical state; the page
 * commands read the pages (`readPages`; a reader without it has the default page only),
 * the token commands the colour tokens (`readTokens`; without it, none), and the style
 * commands the named styles (`readTextStyles`, `readEffectStyles`; without them, none),
 * and the timer command the board timer (`boardTimer`; without it, none).
 */
export type BoardReader = Pick<DocumentStore, 'get' | 'references'> &
  Partial<
    Pick<DocumentStore, 'read' | 'readPages' | 'readTokens' | 'readTextStyles' | 'readEffectStyles'>
  > & {
    /** The board timer, as the timer command reads it; without it, none. */
    readonly boardTimer?: Pick<BoardTimerView, 'current'>;
    /**
     * Where a new root object given no page goes: the page a person is shown, for a
     * view of one page; absent, the board's first page.
     */
    readonly defaultPageId?: () => PageId;
  };

/** Everything a command's `validate` may use, fixed for one run of the command. */
export interface CommandContext {
  /** The board before the command. */
  readonly board: BoardReader;
  /** The origin the command's transaction will carry; `createdBy` comes from its principal. */
  readonly origin: TransactionOrigin;
  /**
   * The command's time, ms since the Unix epoch, read once from the injected clock: the
   * `createdAt` and `updatedAt` of the objects it creates, and the `updatedAt` `runCommand`
   * stamps on everything it writes.
   */
  readonly now: number;
  /**
   * Makes a new object id from the injected generator. Call it only from `validate`, so the
   * ids end up in the plan and `apply` writes exactly what was validated.
   */
  readonly createId: () => ObjectId;
}

/** The outcome of `validate`: a plan to apply, or why the command is refused. */
export type CommandValidation<Plan> =
  | {
      /** The command may run. */
      readonly isValid: true;
      /** Exactly what `apply` will write, computed and validated in full. */
      readonly plan: Plan;
    }
  | {
      /** The command is refused and nothing will be written. */
      readonly isValid: false;
      /** Every problem found; never empty. */
      readonly errors: readonly CommandError[];
    };

/**
 * One command of the command layer: the only way the board changes,
 * for people, tools and agents alike. Commands are plain values listed in `COMMANDS`,
 * and `runCommand` runs them in three steps:
 *
 * 1. `input` parses the caller's input (strict: unknown keys are refused);
 * 2. `validate` checks it against the board as it is (the last completed transaction, read
 *    through `get` and the reverse indexes) and computes the plan: what the command will write,
 *    whole and validated as the store will validate it, with new ids and z keys;
 * 3. only then one transaction carrying the caller's origin runs `apply(transaction, input,
 *    plan)`, which writes the plan. Afterwards `runCommand` stamps `updatedAt` with the command's
 *    time on every object the command wrote, so commands never stamp it themselves (a created
 *    object carries `createdAt` = `updatedAt` = the command's time from its plan).
 *
 * Yjs has no rollback, so a write that fails halfway would leave the earlier writes committed
 * and broadcast. `validate` therefore has to find every problem, and `apply` must not be able to
 * fail on a plan `validate` produced. The plan is also how a command that needs to read the board
 * (a parent's children, sibling z keys) gets what it read into `apply`: the transaction can read
 * single objects but not the reverse indexes. A command whose apply needs nothing beyond its
 * parsed input can use `null` as its plan.
 *
 * @template InputSchema - The Zod schema of the input; it is also what agents are shown.
 * @template Plan - What `validate` hands to `apply`.
 * @template Result - What `apply` returns to the caller.
 */
export interface Command<InputSchema extends z.ZodType, Plan, Result> {
  /** The command's name in the registry, in camelCase (`createObject`). */
  readonly name: string;
  /** One sentence on what the command does, for agents and the MCP tool list. */
  readonly description: string;
  /** Validates and normalises the input. */
  readonly input: InputSchema;
  /**
   * Set when the command keeps every object where it is on the board and only re-expresses or
   * detaches (`group`, `ungroup`, `deleteObjects`): `runCommand` then does not judge its result
   * against the board's bound, which could only differ by the rounding of the
   * re-expression. Every other command's result is judged (`worldBoundViolations`).
   */
  readonly isPlacePreserving?: true;
  /**
   * Checks the parsed input against the board and computes the plan. Reads only; never writes.
   *
   * @param context - The board, origin, time and id generator of this run.
   * @param input - The parsed input.
   * @returns The plan, or every problem found.
   */
  validate(context: CommandContext, input: z.output<InputSchema>): CommandValidation<Plan>;
  /**
   * Writes the plan inside the command's one transaction.
   *
   * @param transaction - The transaction, carrying the caller's origin.
   * @param input - The parsed input `validate` accepted.
   * @param plan - The plan `validate` returned for this run.
   * @returns The command's result.
   */
  apply(transaction: DocumentTransaction, input: z.output<InputSchema>, plan: Plan): Result;
  /**
   * Splits a plan too large for one transaction into parts (a paste or import of
   * thousands of objects, whose one update would exceed the collab client's 1 MiB chunk).
   * `runCommand` applies each part with `apply`, in order, in a transaction of its own, all one
   * undo step; each part must leave the board valid on its own (a peer sees it before the next),
   * so a part never refers to an object of a later part. Optional; absent or `undefined` keeps
   * the one transaction.
   *
   * @param plan - The plan `validate` returned.
   * @param options - How the parts are bounded; absent, at most `MAX_OBJECTS_PER_TRANSACTION`
   *   objects per part, as `runCommand` applies them.
   * @returns The parts and the command's result for the whole plan, or `undefined` when the plan
   *   fits one transaction.
   */
  split?(plan: Plan, options?: SplitOptions): CommandParts<Plan, Result> | undefined;
  /**
   * Parses the input and validates it as `input` and `validate` do, in stages: a
   * stepped run with a staged plan (`startRun`'s `isPlanStaged`) awaits `stage` between them, so
   * planning a paste of thousands of objects never holds the page for long. Same plan, same
   * refusals. Optional; a command without it is planned in one stage.
   *
   * @param context - The board, origin, time and id generator of this run.
   * @param input - The input, before parsing.
   * @param stage - Awaited between two stages; it rejects when the run is to stop.
   * @returns The parsed input and plan, or every problem found.
   */
  planInStages?(
    context: CommandContext,
    input: unknown,
    stage: () => Promise<void>,
  ): Promise<StagedPlanning<z.output<InputSchema>, Plan>>;
}

/** What `Command.planInStages` found. */
export type StagedPlanning<Input, Plan> =
  | {
      /** The input parses and validates. */
      readonly isValid: true;
      /** The parsed input. */
      readonly input: Input;
      /** The plan. */
      readonly plan: Plan;
      /**
       * The new objects of the plan validated whole as the store validates a create, the very
       * objects `apply` writes: the run need not validate their writes again (`StoreRun.certify`).
       */
      readonly validated?: readonly BoardObject[];
    }
  | {
      /** Refused. */
      readonly isValid: false;
      /** Every problem found; never empty. */
      readonly errors: readonly CommandError[];
    };

/**
 * How `Command.split` bounds its parts (a stepped run applies one part per
 * browser task, so a part must fit one task's work).
 */
export interface SplitOptions {
  /**
   * The most planned writes per part (`write-budget.ts`: an object written costs two, a deletion
   * or a side-table entry one), where the plan's order allows; a part that cannot be divided,
   * such as one object, may exceed it. A positive whole number.
   */
  readonly maxWrites?: number;
}

/** A plan split over several transactions, and the result of the whole (`Command.split`). */
export interface CommandParts<Plan, Result> {
  /** The parts, in the order they are applied; at least two. */
  readonly parts: readonly Plan[];
  /** What the command returns, as `apply` would for the whole plan. */
  readonly result: Result;
}

/** Any command, as the registry holds them. */
export type AnyCommand = Command<z.ZodType, unknown, unknown>;

/**
 * Wraps a plan as a successful validation.
 *
 * @param plan - The plan.
 * @returns The validation.
 */
export function accept<Plan>(plan: Plan): CommandValidation<Plan> {
  return { isValid: true, plan };
}

/**
 * Wraps problems as a failed validation.
 *
 * @param errors - The problems; at least one.
 * @returns The validation.
 */
export function reject(errors: readonly CommandError[]): CommandValidation<never> {
  return { isValid: false, errors: Object.freeze([...errors]) };
}
