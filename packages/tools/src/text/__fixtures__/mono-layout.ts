// Layouts for the editor tests: the prototype's monospaced fake measurer (every character 0.6 em
// wide, ascent 0.8 em, descent 0.2 em), so caret positions are hand-computable.
import {
  fontFaceId,
  fontFaceOf,
  layoutText,
  type GlyphMeasurer,
  type TextLayout,
} from '@canvas/engine';
import type { StyleRun } from '@canvas/schema';

/** A monospaced measurer: 0.6 em advances, no kerning. */
export const MONO_MEASURER: GlyphMeasurer = {
  faceIdOf: (style) => fontFaceId(fontFaceOf(style)),
  advance: () => 0.6,
  kerning: () => 0,
  lineMetrics: () => ({ ascent: 0.8, descent: 0.2 }),
};

/**
 * Lays text out with the monospaced measurer.
 *
 * @param text - The characters.
 * @param runs - Their runs.
 * @param maxWidth - The wrapping width; auto width when null.
 * @returns The layout.
 */
export function monoLayout(
  text: string,
  runs: readonly StyleRun[],
  maxWidth: number | null = null,
): TextLayout {
  return layoutText(text, runs, maxWidth, MONO_MEASURER);
}
