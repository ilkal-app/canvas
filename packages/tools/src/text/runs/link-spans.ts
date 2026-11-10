import type { StyleRun } from '@canvas/schema';

/** A stretch of characters that carry one link: a link in a text. */
export interface LinkSpan {
  /** The link. */
  readonly link: string;
  /** Its first character, UTF-16 code units. */
  readonly start: number;
  /** One past its last character. */
  readonly end: number;
}

/**
 * A text's links, in reading order: each stretch of characters whose runs carry the
 * same link is one span, so a link split over runs of different styles counts once, and two
 * links side by side stay two. Pure.
 *
 * @param runs - The text's runs.
 * @returns The spans.
 */
export function linkSpansOf(runs: readonly StyleRun[]): LinkSpan[] {
  const spans: LinkSpan[] = [];
  let index = 0;
  for (const run of runs) {
    const { link } = run.style;
    const last = spans.at(-1);
    if (link !== undefined && run.length > 0) {
      if (last?.link === link && last.end === index)
        spans[spans.length - 1] = { ...last, end: index + run.length };
      else spans.push({ link, start: index, end: index + run.length });
    }
    index += run.length;
  }
  return spans;
}
