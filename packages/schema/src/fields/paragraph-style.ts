import { z } from 'zod';

/** The deepest indent level a list item may have: levels run from 0 to 3. */
export const MAX_LIST_LEVEL = 3;

/**
 * Validates a paragraph's list style: `list` makes the paragraph a bulleted or
 * numbered item and `level` indents it (0 to {@link MAX_LIST_LEVEL}, absent for 0). `{}` is a
 * plain paragraph; a `level` without a `list` is refused.
 */
export const paragraphStyleSchema = z
  .strictObject({
    /** The kind of list item; absent for a plain paragraph. */
    list: z
      .enum(['bullet', 'numbered'])
      .optional()
      .describe('The kind of list item: bullet or numbered; absent for a plain paragraph.'),
    /** The item's indent level, 0 to 3; absent for 0. Only with `list`. */
    level: z
      .number()
      .int()
      .min(0)
      .max(MAX_LIST_LEVEL)
      .optional()
      .describe("The list item's indent level, 0 to 3; absent for 0. Only with list."),
  })
  .refine((style) => style.level === undefined || style.list !== undefined, {
    message: 'a paragraph has a level only when it is a list item',
    path: ['level'],
  })
  .describe('A paragraph: a list item (bullet or numbered, level 0 to 3) or plain ({}).');

/** A paragraph's list style. */
export type ParagraphStyle = z.output<typeof paragraphStyleSchema>;

/**
 * Counts a text's paragraphs: the text split on `'\n'`, so empty text has one.
 *
 * @param text - The characters.
 * @returns The number of `'\n'` plus one.
 */
export function paragraphCount(text: string): number {
  let count = 1;
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    count += 1;
  }
  return count;
}

/**
 * Tells whether two paragraph styles are the same: the same kind of list, at the same level
 * (absent the same as 0); plain paragraphs are all the same.
 *
 * @param first - One paragraph style.
 * @param second - The other.
 * @returns True when they are the same.
 */
export function isSameParagraphStyle(first: ParagraphStyle, second: ParagraphStyle): boolean {
  if (first.list !== second.list) return false;
  return first.list === undefined || (first.level ?? 0) === (second.level ?? 0);
}
