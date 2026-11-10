// The prototype's FakeMeasurer (`src/text/fakeMeasurer.ts`): every character advances the same
// width, kerning comes from a lookup table, and every face has the same line metrics. With
// fontSize 10 a character is 6 wide and a line is 12.5 tall with its baseline at 9.25.
import type { TextStyle } from '@canvas/schema';
import { fontFaceId, fontFaceOf } from '@canvas/text';
import type { GlyphMeasurer, LineMetrics } from '@canvas/text';

/** A monospaced measurer for layout tests. */
export class FakeGlyphMeasurer implements GlyphMeasurer {
  /**
   * Creates the measurer.
   *
   * @param advanceEm - Every character's advance, in em.
   * @param kerningEm - Kerning by two-character string (`'AV'`), in em.
   */
  constructor(
    private readonly advanceEm = 0.6,
    private readonly kerningEm: Readonly<Record<string, number>> = {},
  ) {}

  /**
   * The face id of a style, without fallbacks.
   *
   * @param style - A run's style.
   * @returns Its face id.
   */
  faceIdOf(style: TextStyle): string {
    return fontFaceId(fontFaceOf(style));
  }

  /**
   * The same advance for every character.
   *
   * @returns The advance, in em.
   */
  advance(): number {
    return this.advanceEm;
  }

  /**
   * Kerning from the lookup table.
   *
   * @param faceId - Ignored.
   * @param left - The left character.
   * @param right - The right character.
   * @returns The table's value, in em, or 0.
   */
  kerning(faceId: string, left: number, right: number): number {
    return this.kerningEm[String.fromCodePoint(left, right)] ?? 0;
  }

  /**
   * The same line metrics for every face.
   *
   * @returns Ascent 0.8 em and descent 0.2 em.
   */
  lineMetrics(): LineMetrics {
    return { ascent: 0.8, descent: 0.2 };
  }
}
