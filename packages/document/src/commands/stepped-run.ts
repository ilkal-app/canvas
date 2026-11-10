import type { BoardObject, ObjectId } from '@canvas/schema';

import { inPartsScope, openStep } from '../history/undo-groups.js';
import type { ChangeSet, DocumentStore } from '../store/document-store.js';
import { RunStoppedError, type StoreRun } from '../store/store-run.js';

import {
  emptyChangeSet,
  mergeChangeSets,
  type PlannedRun,
  type RunCommandOptions,
} from './run-command.js';
import { OBJECT_WRITES, packByWrites } from './write-budget.js';

// The parts of a stepped run (`startRun`), applied a browser task each.

/** How `startRun` applies a command. */
export interface StartRunOptions extends RunCommandOptions {
  /** The most planned writes per part (`write-budget.ts`); a positive whole number. */
  readonly maxWrites: number;
  /** Lets the browser run between two parts: `yieldToBrowser` in a page. */
  readonly yieldToBrowser: () => Promise<void>;
  /**
   * Plans the command in stages, with the store already held: `startRun` opens the run
   * first, then parses and validates the command a stage at a time (`Command.planInStages`, else
   * in one stage), yielding between stages, and applies its parts after. Its refusal then comes
   * as a `RunRefusedError` rejection, not a value.
   */
  readonly isPlanStaged?: boolean;
}

/** What a stepped run did (`startRun`). */
export interface RunReport<Result> {
  /** What the command returned, as `runCommand` returns it. */
  readonly result: Result;
  /** What all its parts changed, in order, as `runCommand` reports it. */
  readonly changes: ChangeSet;
  /**
   * How many transactions the run made: the command's parts, and any leading parts of its
   * cycle-normalized roots or trailing parts of its auto-layout; 1 when it made one.
   */
  readonly parts: number;
  /** How many parts were committed: all of them. */
  readonly committedParts: number;
  /** The slowest part's milliseconds, its transaction and its page delivery. */
  readonly slowestPartMs: number;
  /**
   * Whether a part made more planned writes than `maxWrites`: one the command could not divide,
   * such as one large object.
   */
  readonly isOverBudget: boolean;
}

/** One transaction of a stepped run: a part of the plan, or some of its roots or auto-layout. */
export type Step<Plan> =
  | {
      readonly part: Plan;
      readonly hasRoots: boolean;
      readonly hasLayout: boolean;
    }
  | { readonly objects: readonly BoardObject[] };

/**
 * The transactions of a stepped run: the plan whole when it, its cycle-normalized roots and its
 * auto-layout fit one part's budget; otherwise the roots in leading parts of their own (they only
 * repair objects already on the board, so writing them first leaves every prefix valid), the
 * plan's parts, and the auto-layout in trailing parts (every frame it writes stands in the final
 * state, so every prefix is valid), each packed by `maxWrites`.
 *
 * @param run - The planned command.
 * @param first - Its first part; the plan whole when it does not split.
 * @param rest - Its other parts.
 * @param maxWrites - The budget per part.
 * @returns The first step and the others, in order.
 */
export function stepsOf<Plan, Result>(
  run: PlannedRun<Plan, Result>,
  first: Plan,
  rest: readonly Plan[],
  maxWrites: number,
): RunSteps<Plan> {
  const extras = (run.roots.length + run.layout.length) * OBJECT_WRITES;
  const isWhole = extras === 0 || extras + run.writtenObjects * OBJECT_WRITES <= maxWrites;
  if (rest.length === 0 && isWhole) {
    return { first: { part: first, hasRoots: true, hasLayout: true }, rest: [] };
  }
  const packed = (objects: readonly BoardObject[]): Step<Plan>[] =>
    objects.length === 0
      ? []
      : packByWrites(objects, () => OBJECT_WRITES, maxWrites).map((chunk) => ({ objects: chunk }));
  const part = (plan: Plan): Step<Plan> => ({ part: plan, hasRoots: false, hasLayout: false });
  const [leading, ...roots] = packed(run.roots);
  const others = [...rest.map(part), ...packed(run.layout)];
  return leading === undefined
    ? { first: part(first), rest: others }
    : { first: leading, rest: [...roots, part(first), ...others] };
}

/** A stepped run's transactions: the first, applied in the calling task, and the others. */
export interface RunSteps<Plan> {
  /** The first. */
  readonly first: Step<Plan>;
  /** The others, a task each. */
  readonly rest: readonly Step<Plan>[];
}

/** The parts of one stepped run, applied a task each (`startRun`). */
export class SteppedRun<Plan, Result> {
  readonly #store: DocumentStore;
  readonly #run: PlannedRun<Plan, Result>;
  readonly #steps: RunSteps<Plan>;
  readonly #options: StartRunOptions;
  readonly #storeRun: StoreRun;
  readonly #changeSets: ChangeSet[] = [];
  #committed = 0;
  #slowestMs = 0;
  #isOverBudget = false;
  #result: Result | undefined;

  /**
   * Prepares the run.
   *
   * @param store - The store written.
   * @param run - The planned command.
   * @param steps - Its transactions.
   * @param options - The budget and the yield.
   * @param storeRun - The open run holding the store.
   */
  constructor(
    store: DocumentStore,
    run: PlannedRun<Plan, Result>,
    steps: RunSteps<Plan>,
    options: StartRunOptions,
    storeRun: StoreRun,
  ) {
    this.#store = store;
    this.#run = run;
    this.#steps = steps;
    this.#options = options;
    this.#storeRun = storeRun;
  }

  /**
   * How many transactions the run makes.
   *
   * @returns The count.
   */
  get #count(): number {
    return 1 + this.#steps.rest.length;
  }

  /**
   * Applies the first part now, and the rest after yields.
   *
   * @param split - The split's result for the whole command, when it split.
   * @param split.result - That result.
   * @returns The report, or a rejection.
   */
  start(split: { readonly result: Result } | undefined): Promise<RunReport<Result>> {
    // One undo step over the parts; a plan applied whole is one transaction, as runCommand's.
    const endStep = this.#count > 1 ? openStep(this.#store) : () => undefined;
    const release = (): void => {
      endStep();
      this.#storeRun.close();
    };
    try {
      this.#applyPart(this.#steps.first);
    } catch (error) {
      release();
      return Promise.reject(this.#stopped(error));
    }
    if (this.#count === 1) {
      release();
      return Promise.resolve(this.#report(split));
    }
    return this.#continue(split).finally(release);
  }

  /**
   * Applies the remaining parts, a task each.
   *
   * @param split - The split's result for the whole command.
   * @returns The report.
   * @throws {RunStoppedError} When a yield rejected or a part threw.
   */
  async #continue(split: { readonly result: Result } | undefined): Promise<RunReport<Result>> {
    for (const step of this.#steps.rest) {
      try {
        await this.#options.yieldToBrowser();
        this.#storeRun.checkStop();
        this.#applyPart(step);
      } catch (error) {
        throw this.#stopped(error);
      }
    }
    return this.#report(split);
  }

  /**
   * Applies one part in its own transaction, inside the run's authority, and delivers it to the
   * page listeners after that authority ended.
   *
   * @param step - The part, or the roots or auto-layout it writes alone.
   * @throws {unknown} What the part's transaction or its listeners threw.
   */
  #applyPart(step: Step<Plan>): void {
    const started = performance.now();
    const state = { isCommitted: false };
    try {
      inPartsScope(
        this.#store,
        () => {
          this.#storeRun.enter(() => {
            const onWritten = (writes: number): void => {
              state.isCommitted = true;
              if (writes > this.#options.maxWrites) this.#isOverBudget = true;
            };
            if ('objects' in step) {
              this.#run.applyObjects(this.#store, this.#changeSets, step.objects, onWritten);
              return;
            }
            const result = this.#run.applyPart(
              this.#store,
              this.#changeSets,
              step.part,
              step,
              onWritten,
            );
            // Unsplit, the plan's one step returns the command's result; split, `start` has it.
            this.#result = result;
          });
        },
        () => undefined,
      );
    } finally {
      // A part whose listener threw after its commit is committed all the same, and reported.
      if (state.isCommitted) this.#storeRun.progress(++this.#committed, this.#count);
      this.#slowestMs = Math.max(this.#slowestMs, performance.now() - started);
    }
  }

  /**
   * The error a stopped run rejects with.
   *
   * @param cause - Why it stopped.
   * @returns The error.
   */
  #stopped(cause: unknown): RunStoppedError {
    return new RunStoppedError(this.#committed, this.#changes(), cause, this.#count);
  }

  /**
   * What the committed parts changed, each id once, each list sorted, as one transaction's change
   * set lists them.
   *
   * @returns The change set.
   */
  #changes(): ChangeSet {
    const [only] = this.#changeSets;
    if (only !== undefined && this.#changeSets.length === 1 && this.#count === 1) {
      return only;
    }
    if (this.#changeSets.length === 0) return emptyChangeSet(this.#run.context.origin);
    // As one transaction's change set reads: each id once, each list sorted.
    const merged = mergeChangeSets(this.#changeSets, this.#run.context);
    const sorted = (ids: readonly ObjectId[]) => Object.freeze([...ids].sort());
    return Object.freeze({
      ...merged,
      created: sorted(merged.created),
      updated: sorted(merged.updated),
      deleted: sorted(merged.deleted),
    });
  }

  /**
   * The report of a run whose parts all went in.
   *
   * @param split - The split's result for the whole command, when it split.
   * @returns The report.
   */
  #report(split: { readonly result: Result } | undefined): RunReport<Result> {
    return {
      result: split === undefined ? (this.#result as Result) : split.result,
      changes: this.#changes(),
      parts: this.#count,
      committedParts: this.#committed,
      slowestPartMs: this.#slowestMs,
      isOverBudget: this.#isOverBudget,
    };
  }
}
