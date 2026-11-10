/** What happened to a pointer: pressed, moved, released, or taken away by the browser. */
export type PointerInputType = 'down' | 'move' | 'up' | 'cancel';

/**
 * One pointer event as the engine receives it, forwarded from the page's DOM event with its
 * timestamp. Plain data, so it crosses to the engine worker unchanged.
 */
export interface PointerInput {
  /** What happened. */
  readonly type: PointerInputType;
  /** Horizontal position, CSS px from the canvas's left edge. */
  readonly xPx: number;
  /** Vertical position, CSS px from the canvas's top edge. */
  readonly yPx: number;
  /** The pressed buttons as the DOM's `PointerEvent.buttons` bit mask. */
  readonly buttons: number;
  /** The DOM's `pointerId`: one per finger, pen or mouse. */
  readonly pointerId: number;
  /**
   * When the event happened: the DOM event's `timeStamp`, ms on the page's clock
   * (`performance.now()` of the main thread), kept as it was even when the event is handled
   * later or in the worker.
   */
  readonly timestampMs: number;
}

/**
 * Coalesces the pointer inputs that arrived between two frames (input is gathered once per
 * frame). For each pointer the last of a run of moves wins; presses, releases and
 * cancels are always kept, and so is a move whose buttons differ from that pointer's next move,
 * so no button transition is lost. What remains keeps its order and its own timestamps. Pure.
 *
 * @param inputs - The inputs in arrival order; not mutated.
 * @returns A new list of the inputs that matter to the frame.
 */
export function coalescePointerInputs(inputs: readonly PointerInput[]): PointerInput[] {
  // Walk backwards, remembering each pointer's next kept input, so every move is compared with
  // what follows it for the same pointer in one pass.
  const nextByPointer = new Map<number, PointerInput>();
  const kept: PointerInput[] = [];
  for (let index = inputs.length - 1; index >= 0; index -= 1) {
    const input = inputs[index];
    if (input === undefined) continue;
    const next = nextByPointer.get(input.pointerId);
    const isSuperseded =
      input.type === 'move' && next?.type === 'move' && next.buttons === input.buttons;
    if (isSuperseded) continue;
    kept.push(input);
    nextByPointer.set(input.pointerId, input);
  }
  return kept.reverse();
}
