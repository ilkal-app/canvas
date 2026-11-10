import type { TextBoxGeometry } from './text-placement.js';

/** Snapshot of the immutable source inputs that affect glyph layout. */
type LayoutInputs = Pick<TextBoxGeometry, 'text' | 'runs' | 'wrapWidth' | 'align' | 'direction'> & {
  readonly fitHeight: number | undefined;
  readonly lineCaps: TextBoxGeometry['lineCaps'];
  readonly paragraphs: TextBoxGeometry['paragraphs'];
};

/** Per-object key memoization: movement must not stringify every style run again. */
export class TextLayoutKey {
  private input: LayoutInputs | undefined;
  private fonts = '';
  private value = '';

  /**
   * Keys the same inputs as full layout serialization, reusing the key for unchanged immutable
   * style-run arrays. New runs, text, wrapping, alignment, direction, a note's fit height,
   * line caps, paragraph styles or font catalogue invalidate it.
   *
   * @param geometry - Current text box; placement fields do not affect the local layout.
   * @param fonts - Current font selection key.
   * @returns Exact serialized layout key.
   */
  of(geometry: TextBoxGeometry, fonts: string): string {
    const { text, runs, wrapWidth, align, direction, fitHeight, lineCaps, paragraphs } = geometry;
    const before = this.input;
    if (
      before !== undefined &&
      this.fonts === fonts &&
      before.text === text &&
      before.runs === runs &&
      before.wrapWidth === wrapWidth &&
      before.align === align &&
      before.direction === direction &&
      before.fitHeight === fitHeight &&
      before.lineCaps === lineCaps &&
      before.paragraphs === paragraphs
    ) {
      return this.value;
    }
    this.input = { text, runs, wrapWidth, align, direction, fitHeight, lineCaps, paragraphs };
    this.fonts = fonts;
    this.value = JSON.stringify([
      fonts,
      wrapWidth,
      align,
      direction,
      fitHeight ?? null,
      runs,
      text,
      // Plain text keys as before.
      ...(paragraphs === undefined ? [] : [paragraphs]),
      // So does text without line caps.
      ...(lineCaps === undefined ? [] : [{ lineCaps }]),
    ]);
    return this.value;
  }
}
