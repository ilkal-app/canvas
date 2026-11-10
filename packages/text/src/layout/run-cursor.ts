/** One run as the cursor sees it: where it ends and what it carries. */
export interface RunSpan<T> {
  /** The run's position in the run list. */
  readonly index: number;
  /** Exclusive end of the run, in UTF-16 code units from the start of the text. */
  readonly end: number;
  /** What the caller attached to the run (for layout, the resolved run). */
  readonly value: T;
  /** The run before, if any. */
  readonly previous: RunSpan<T> | undefined;
  /** The run after, if any. */
  next: RunSpan<T> | undefined;
}

/**
 * Finds the style run covering a text index. Wrapping rewinds the layout's index, so the cursor
 * moves both ways from where it last stopped, and a pass over the text costs O(text + runs).
 * Indices at or past the end belong to the last run (the prototype's `runIndexAt`,
 * `src/text/layout.ts`).
 */
export class RunCursor<T> {
  private current: RunSpan<T>;

  /**
   * Links the runs.
   *
   * @param runs - Each run's length in UTF-16 code units and the value to attach, in order.
   * @throws {RangeError} When there are no runs: text always has at least one.
   */
  constructor(runs: readonly { readonly length: number; readonly value: T }[]) {
    let previous: RunSpan<T> | undefined;
    let first: RunSpan<T> | undefined;
    let end = 0;
    runs.forEach(({ length, value }, index) => {
      end += length;
      const span: RunSpan<T> = { index, end, value, previous, next: undefined };
      if (previous === undefined) first = span;
      else previous.next = span;
      previous = span;
    });
    if (first === undefined) throw new RangeError('Text needs at least one style run.');
    this.current = first;
  }

  /**
   * The run covering a text index.
   *
   * @param index - A UTF-16 index.
   * @returns The run's span.
   */
  at(index: number): RunSpan<T> {
    while (this.current.previous !== undefined && index < this.current.previous.end) {
      this.current = this.current.previous;
    }
    while (this.current.next !== undefined && index >= this.current.end) {
      this.current = this.current.next;
    }
    return this.current;
  }
}
