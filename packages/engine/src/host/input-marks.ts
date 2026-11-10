/**
 * Input marks: a benchmark names one input, the engine carries the name with the next
 * frame, and reports it back once the GPU has finished that frame's work. The latency they
 * measure ends at GPU completion, not presentation: the compositor's own frame comes after.
 */

/**
 * The inputs the benchmark measures from event to GPU completion; `draw-move` is a pressed move
 * of the draw tool, whose live stroke is meshed in the next frame. `ink-handoff` is not
 * a measured input: the page's live ink overlay marks a written stroke with it, and the frame
 * that takes it has the stroke in its scene.
 */
export type InputMarkKind =
  'drag-end' | 'zoom-step' | 'selection-change' | 'keystroke' | 'draw-move' | 'ink-handoff';

/** Every {@link InputMarkKind}, in a fixed order. */
export const INPUT_MARK_KINDS: readonly InputMarkKind[] = [
  'drag-end',
  'zoom-step',
  'selection-change',
  'keystroke',
  'draw-move',
  'ink-handoff',
];

/** One measured input, as the page names it; carried with the next frame and returned unchanged. */
export interface InputMark {
  /** Which input it is. */
  readonly kind: InputMarkKind;
  /** Positive, increasing per page: tells two marks of one frame apart. */
  readonly id: number;
  /** When the input event happened (`event.timeStamp`), ms on the page's clock. */
  readonly timestampMs: number;
  /** When the page's handlers had run and the mark was made, ms on the page's clock. */
  readonly markedMs: number;
}

/** The marks of one frame, once the GPU finished the work that frame submitted. */
export interface EngineInputsCompleted {
  /** The frame's sequence number, as in its `EngineFrameReport`. */
  readonly frameIndex: number;
  /** When the frame began, ms on the page's clock (the runtime's own clock inside a runtime). */
  readonly frameTimeMs: number;
  /** The marks the frame carried, oldest first. */
  readonly marks: readonly InputMark[];
  /** Whether the frame left work a later frame will show: its marks are then partial. */
  readonly hasPendingWork: boolean;
  /**
   * When the GPU work was known complete, ms on the page's clock (the runtime's own clock inside
   * a runtime); at frame end on a backend that cannot tell.
   */
  readonly completedMs: number;
}

/**
 * Receives each frame's completed input marks.
 *
 * @param completion - The frame's marks and when its GPU work finished.
 */
export type EngineInputsCompletedListener = (completion: EngineInputsCompleted) => void;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Checks an input mark that crossed a thread.
 *
 * @param value - The received value.
 * @returns `true` for a known kind with finite numbers.
 */
export function isInputMark(value: unknown): value is InputMark {
  if (typeof value !== 'object' || value === null) return false;
  const mark = value as Readonly<Record<string, unknown>>;
  return (
    INPUT_MARK_KINDS.includes(mark.kind as InputMarkKind) &&
    isFiniteNumber(mark.id) &&
    isFiniteNumber(mark.timestampMs) &&
    isFiniteNumber(mark.markedMs)
  );
}

/**
 * Checks a completion that crossed a thread.
 *
 * @param value - The received value.
 * @returns `true` for finite times and a list of well-formed marks.
 */
export function isEngineInputsCompleted(value: unknown): value is EngineInputsCompleted {
  if (typeof value !== 'object' || value === null) return false;
  const completion = value as Readonly<Record<string, unknown>>;
  return (
    isFiniteNumber(completion.frameIndex) &&
    isFiniteNumber(completion.frameTimeMs) &&
    isFiniteNumber(completion.completedMs) &&
    typeof completion.hasPendingWork === 'boolean' &&
    Array.isArray(completion.marks) &&
    completion.marks.every(isInputMark)
  );
}
