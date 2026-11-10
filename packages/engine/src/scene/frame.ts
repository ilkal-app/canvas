import type { FrameContext, FrameStage } from './frame-context.js';

/** Where {@link Frame.insertStage} puts a stage relative to its anchor. */
export type StagePosition = 'before' | 'after';

/**
 * The frame loop as an ordered list of stages, and the engine's extension point: later work
 * adds or wraps stages instead of editing the loop. Z-order segments insert a stage
 * after `cull` that rewrites {@link FrameContext.drawList} segment-major; stage timers
 * implement the {@link FrameContext.timers} hook or wrap stages. Stages share live references,
 * so the engine worker host runs the whole renderer in the worker rather than moving
 * stages. See the package README, "Frame pipeline".
 */
export class Frame {
  private readonly stages: FrameStage[];
  private readonly transient = new WeakMap<FrameStage, FrameStage['run']>();
  private readonly pendingWork: (() => boolean)[] = [];

  /**
   * Creates a frame from stages in run order.
   *
   * @param stages - The stages.
   * @throws {RangeError} When two stages share a name.
   */
  constructor(stages: readonly FrameStage[]) {
    this.stages = [];
    for (const stage of stages) this.add(this.stages.length, stage);
  }

  /**
   * The stages' names in run order.
   *
   * @returns The names.
   */
  get stageNames(): readonly string[] {
    return this.stages.map((stage) => stage.name);
  }

  /**
   * Registers work a stage still has in hand for later frames (slot compaction), so the
   * frame loop keeps drawing until it is done though nothing else changed (`hasPendingWork`).
   *
   * @param isPending - Whether the stage still has work; asked whenever the loop decides.
   */
  addPendingWork(isPending: () => boolean): void {
    this.pendingWork.push(isPending);
  }

  /**
   * Whether any stage registered with {@link Frame.addPendingWork} still has work in hand.
   *
   * @returns True while one does.
   */
  hasPendingWork(): boolean {
    return this.pendingWork.some((isPending) => isPending());
  }

  /**
   * Adds a stage next to an existing one.
   *
   * @param position - Before or after the anchor.
   * @param anchorName - The name of the stage to insert next to.
   * @param stage - The new stage; its name must be unused.
   * @throws {RangeError} When the anchor does not exist or the name is taken.
   */
  insertStage(position: StagePosition, anchorName: string, stage: FrameStage): void {
    const anchor = this.indexOf(anchorName);
    this.add(position === 'before' ? anchor : anchor + 1, stage);
  }

  /**
   * Inserts a document-independent overlay after drawing. The caller promises that this stage
   * changes only transient overlay pixels, never document geometry, camera, resources or queues.
   * Such pixels are excluded from persisted document-preview certificates.
   *
   * @param stage - Transient overlay stage with an unused name.
   * @throws {RangeError} When draw is absent or the name is taken.
   */
  insertTransientOverlay(stage: FrameStage): void {
    this.insertStage('after', 'draw', stage);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Identity comparison only; never called unbound.
    this.transient.set(stage, stage.run);
  }

  /**
   * Captures exact content stages and callbacks, excluding explicitly transient overlays.
   * Later unrecognized insertion, wrapping or mutation invalidates this capture.
   *
   * @returns A synchronous structure check; it does not certify resource readiness.
   */
  captureContentStructure(): () => boolean {
    const snapshot = this.stages
      .filter((stage) => !this.transient.has(stage))
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Identity comparison only; never called unbound.
      .map((stage) => ({ stage, name: stage.name, run: stage.run }));
    return () => {
      let index = 0;
      for (const stage of this.stages) {
        const transient = this.transient.get(stage);
        if (transient !== undefined) {
          if (stage.run !== transient) return false;
          continue;
        }
        const expected = snapshot[index++];
        if (expected?.stage !== stage || expected.name !== stage.name || expected.run !== stage.run)
          return false;
      }
      return index === snapshot.length;
    };
  }

  /**
   * Replaces a stage with a wrapper around it, in the same position.
   *
   * @param name - The stage to wrap.
   * @param wrap - Builds the replacement from the current stage; it must keep the name.
   * @throws {RangeError} When no stage has that name or the wrapper renames it.
   */
  wrapStage(name: string, wrap: (stage: FrameStage) => FrameStage): void {
    const index = this.indexOf(name);
    const stage = this.stages[index];
    if (!stage) throw new RangeError(`The frame has no stage named "${name}".`);
    const wrapped = wrap(stage);
    if (wrapped.name !== name) {
      throw new RangeError(
        `A wrapper of stage "${name}" must keep its name, not "${wrapped.name}".`,
      );
    }
    this.stages[index] = wrapped;
  }

  /**
   * Runs every stage once, in order, reporting each to `context.timers`. A stage that throws
   * ends the frame; its `stageEnded` is still reported.
   *
   * @param context - The frame's context.
   * @throws {Error} Whatever a stage throws.
   */
  run(context: FrameContext): void {
    for (const stage of this.stages) {
      context.timers.stageStarted(stage.name);
      try {
        stage.run(context);
      } finally {
        context.timers.stageEnded(stage.name);
      }
    }
  }

  private indexOf(name: string): number {
    const index = this.stages.findIndex((stage) => stage.name === name);
    if (index < 0) throw new RangeError(`The frame has no stage named "${name}".`);
    return index;
  }

  private add(index: number, stage: FrameStage): void {
    if (this.stages.some((existing) => existing.name === stage.name)) {
      throw new RangeError(`The frame already has a stage named "${stage.name}".`);
    }
    this.stages.splice(index, 0, stage);
  }
}
