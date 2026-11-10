import type { PointerInput } from '@canvas/engine';

/** A latency distribution of the current stroke, ms. */
export interface InkLatencySummary {
  /** Measured inputs. */
  readonly count: number;
  /** The median, ms; 0 with none. */
  readonly p50Ms: number;
  /** The largest, ms; 0 with none. */
  readonly maxMs: number;
}

/** What the readout shows of the current (or last) stroke. */
export interface InkStrokeSummary {
  /** Input to the engine's report of the frame that took it. */
  readonly drawn: InkLatencySummary;
  /** Input to the start of the next page frame after that report: the closest the page sees to presentation. */
  readonly presented: InkLatencySummary;
  /** Input to the page's live ink overlay having drawn it, on the page's animation frame. */
  readonly painted: InkLatencySummary;
  /** Input to the start of the next page frame after that paint: as `presented`, for the overlay. */
  readonly paintPresented: InkLatencySummary;
}

/**
 * A distribution's median and maximum. Pure.
 *
 * @param values - The values, ms.
 * @returns The summary.
 */
function summaryOf(values: readonly number[]): InkLatencySummary {
  if (values.length === 0) return { count: 0, p50Ms: 0, maxMs: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50Ms: sorted[Math.floor((sorted.length - 1) / 2)] ?? 0,
    maxMs: sorted.at(-1) ?? 0,
  };
}

/**
 * Ink latency of the stroke being drawn (`?inkdebug=1`), from the pressed pointer
 * inputs each engine frame reports: for each, input to the frame's report reaching the page
 * ("drawn"), and input to the start of the next page frame after it ("presented"). A press
 * starts a new stroke. With the page's live ink overlay drawing the stroke, the engine draws it
 * hidden, and what the pen shows is the overlay's paint: input to that paint ("painted"), from
 * the overlay's own reports, and input to the start of the next page frame after it. The engine keeps each frame's latest move per pointer, so each figure is
 * that frame's freshest input. Every time is on the page's clock. Pure, but for its own state.
 */
export class InkLatencyTracker {
  private drawn: number[] = [];
  private presented: number[] = [];
  /** Inputs drawn but not yet followed by a page frame: their timestamps. */
  private awaiting: number[] = [];
  private painted: number[] = [];
  private paintPresented: number[] = [];
  /** Inputs the overlay painted, not yet followed by a page frame that started after the paint. */
  private awaitingPaint: { readonly inputMs: number; readonly paintedMs: number }[] = [];
  /** The stroke the overlay's paints are of. */
  private paintedStroke: number | undefined;

  /**
   * Takes one frame's pointer inputs.
   *
   * @param inputs - The inputs the frame took.
   * @param receivedMs - When the page received its report, ms.
   */
  frame(inputs: readonly PointerInput[], receivedMs: number): void {
    for (const input of inputs) {
      if (input.type === 'down') {
        this.drawn = [];
        this.presented = [];
        this.awaiting = [];
        continue;
      }
      if (input.type !== 'move' || input.buttons === 0) continue;
      this.drawn.push(receivedMs - input.timestampMs);
      this.awaiting.push(input.timestampMs);
    }
  }

  /**
   * Takes one paint of the page's live ink overlay that showed a new input: input to drawn on
   * the page. A paint of another stroke starts that stroke's figures.
   *
   * @param strokeId - The stroke it showed.
   * @param inputMs - When its newest input was made, ms.
   * @param paintedMs - When the overlay had drawn it, ms.
   */
  overlayPaint(strokeId: number, inputMs: number, paintedMs: number): void {
    if (strokeId !== this.paintedStroke) {
      this.paintedStroke = strokeId;
      this.painted = [];
      this.paintPresented = [];
      this.awaitingPaint = [];
    }
    this.painted.push(paintedMs - inputMs);
    this.awaitingPaint.push({ inputMs, paintedMs });
  }

  /**
   * Takes the start of a page frame: the inputs drawn, or painted by the overlay, before it are
   * presented by it.
   *
   * @param frameMs - The page frame's timestamp, ms.
   */
  pageFrame(frameMs: number): void {
    for (const timestampMs of this.awaiting) this.presented.push(frameMs - timestampMs);
    this.awaiting = [];
    // A paint in this same frame (an earlier animation frame callback) waits for the next one.
    const due = this.awaitingPaint.filter(({ paintedMs }) => paintedMs <= frameMs);
    this.awaitingPaint = this.awaitingPaint.filter(({ paintedMs }) => paintedMs > frameMs);
    for (const { inputMs } of due) this.paintPresented.push(frameMs - inputMs);
  }

  /**
   * The current (or last) stroke's figures.
   *
   * @returns The summary.
   */
  summary(): InkStrokeSummary {
    return {
      drawn: summaryOf(this.drawn),
      presented: summaryOf(this.presented),
      painted: summaryOf(this.painted),
      paintPresented: summaryOf(this.paintPresented),
    };
  }
}

/**
 * Whether the page asked for the ink latency readout (`?inkdebug=1`). Pure.
 *
 * @param search - The page's query string.
 * @returns True when asked.
 */
export function isInkDebug(search: string): boolean {
  return new URLSearchParams(search).get('inkdebug') === '1';
}
