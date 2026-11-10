import type { GpuBackend } from '../gpu/gpu-backend.js';

import type { EngineRuntimeCallbacks } from './engine-runtime-extensions.js';
import type { InputMark } from './input-marks.js';
import { coalescePointerInputs, type PointerInput } from './pointer-input.js';

/** What one frame takes from the queue. */
export interface FrameInputs {
  /** The pointer inputs, coalesced, oldest first. */
  readonly pointerInputs: readonly PointerInput[];
  /** The input marks, oldest first. */
  readonly marks: readonly InputMark[];
}

/** A drawn frame whose marks wait for its GPU work. */
export interface MarkedFrame {
  /** The frame's sequence number. */
  readonly frameIndex: number;
  /** When it began, ms on the runtime's clock. */
  readonly frameTimeMs: number;
  /** Whether it left work a later frame will show. */
  readonly hasPendingWork: boolean;
}

/**
 * An `EngineRuntime`'s queued inputs: pointer inputs for the next frame's report, and input marks
 * reported once the GPU finished the drawn frame's work. A frame that throws puts its
 * inputs back. Waiting for the GPU never delays a frame; a failed wait (a lost device) drops the
 * marks and counts them.
 */
export class RuntimeInputs {
  private pointers: PointerInput[] = [];
  private marks: InputMark[] = [];
  private droppedCount = 0;

  /**
   * Creates the queue.
   *
   * @param live - The backend drawing now (it changes after device loss); none once destroyed.
   * @param now - The runtime's clock, ms.
   * @param callbacks - Where completed marks go (`onInputsCompleted`).
   */
  constructor(
    private readonly live: () => { readonly backend: GpuBackend } | undefined,
    private readonly now: () => number,
    private readonly callbacks: Pick<EngineRuntimeCallbacks, 'onInputsCompleted'>,
  ) {}

  /**
   * How many marks were dropped because their frame's GPU completion failed.
   *
   * @returns The count so far.
   */
  get droppedMarks(): number {
    return this.droppedCount;
  }

  /**
   * Queues a pointer input for the next frame.
   *
   * @param input - The input.
   */
  pointer(input: PointerInput): void {
    this.pointers.push(input);
  }

  /**
   * Queues an input mark for the next frame.
   *
   * @param mark - The mark.
   */
  mark(mark: InputMark): void {
    this.marks.push(mark);
  }

  /**
   * Takes everything queued for the frame about to run.
   *
   * @returns The frame's inputs.
   */
  take(): FrameInputs {
    return {
      pointerInputs: coalescePointerInputs(this.pointers.splice(0)),
      marks: this.marks.splice(0),
    };
  }

  /**
   * Puts a failed frame's inputs back, ahead of any queued since: the next frame reports them.
   *
   * @param inputs - What the frame took.
   */
  restore(inputs: FrameInputs): void {
    this.pointers.unshift(...inputs.pointerInputs);
    this.marks.unshift(...inputs.marks);
  }

  /**
   * Reports a drawn frame's marks once its submitted work is done, at once on a backend that
   * cannot tell; nothing once the runtime is destroyed.
   *
   * @param frame - The frame.
   * @param inputs - What it took; nothing happens without marks.
   */
  complete(frame: MarkedFrame, inputs: FrameInputs): void {
    const { marks } = inputs;
    const backend = this.live()?.backend;
    if (marks.length === 0 || backend === undefined) return;
    const report = (): void => {
      if (this.live() === undefined) return;
      this.callbacks.onInputsCompleted?.({ ...frame, marks, completedMs: this.now() });
    };
    const done = backend.whenSubmittedWorkDone?.();
    if (done === undefined) {
      report();
      return;
    }
    done.then(report, () => {
      this.droppedCount += marks.length;
    });
  }
}
