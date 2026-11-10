import { z } from 'zod';

import type { BoardIssueCode } from '../rules/board-issue.js';

import { isCharacterBoundary } from './character-boundary.js';
import { paragraphCount, paragraphStyleSchema, type ParagraphStyle } from './paragraph-style.js';
import { isSameTextStyle, styleRunSchema, type StyleRun } from './text-style.js';

/**
 * Finds the runs that start inside a surrogate pair, splitting one character between two runs.
 * Yjs stores each run's characters as its own string and encodes a lone surrogate as U+FFFD, so
 * such runs would leave the writer holding the character and every peer two replacement
 * characters, never converging (see {@link isCharacterBoundary}).
 *
 * @param text - The characters the runs cover.
 * @param runs - The style runs, in order; not modified.
 * @returns The indexes of the offending runs, in order; empty when every boundary falls between
 *   characters.
 */
export function findRunsSplittingCharacters(text: string, runs: readonly StyleRun[]): number[] {
  const offending: number[] = [];
  let position = 0;
  runs.forEach((run, index) => {
    if (index > 0 && !isCharacterBoundary(text, position)) offending.push(index);
    position += run.length;
  });
  return offending;
}

/**
 * Describes a run that starts inside a surrogate pair.
 *
 * @param index - The run's index.
 * @returns The message.
 */
function splitCharacterMessage(index: number): string {
  return `run ${String(index)} starts inside a surrogate pair; run boundaries must fall between characters`;
}

/**
 * Lists the ways `runs` fail to cover `text`: no runs, a misplaced zero-length run, unmerged
 * neighbours, or lengths that do not sum to the text length.
 *
 * @param text - The characters the runs cover.
 * @param runs - The style runs, in order.
 * @returns One message per problem, in order.
 */
function findCoverageIssues(text: string, runs: readonly StyleRun[]): string[] {
  if (runs.length === 0) {
    return ['runs must hold at least one run'];
  }
  const issues: string[] = [];
  let total = 0;
  runs.forEach((run, index) => {
    if (run.length === 0 && !(text.length === 0 && runs.length === 1)) {
      issues.push(
        `run ${String(index)} has length 0 but only empty text may have a zero-length run`,
      );
    }
    const previous = runs[index - 1];
    if (previous !== undefined && isSameTextStyle(previous.style, run.style)) {
      issues.push(
        `runs ${String(index - 1)} and ${String(index)} have equal styles and must be merged`,
      );
    }
    total += run.length;
  });
  if (total !== text.length) {
    issues.push(
      `run lengths sum to ${String(total)} but the text has ${String(text.length)} UTF-16 code units`,
    );
  }
  return issues;
}

/**
 * Lists the ways `runs` break the run invariant for `text` (the prototype's `assertRuns`,
 * `src/text/runs.ts`): there is at least one run; lengths sum to the text's length in UTF-16
 * code units; only empty text has a zero-length run, and then it is the only run (it carries
 * the style typing will use); adjacent runs never have equal styles (they would be merged);
 * every run boundary falls between characters, never inside a surrogate pair
 * ({@link findRunsSplittingCharacters}).
 *
 * @param text - The characters the runs cover.
 * @param runs - The style runs, in order.
 * @returns One human-readable message per problem, in order, the boundary problems last; empty
 *   when the runs are valid.
 */
export function findRunIssues(text: string, runs: readonly StyleRun[]): string[] {
  return [
    ...findCoverageIssues(text, runs),
    ...findRunsSplittingCharacters(text, runs).map(splitCharacterMessage),
  ];
}

/**
 * Adds one issue for every way `value.runs` breaks the run invariant, and one when
 * `value.paragraphs` does not hold one style per paragraph. Shared by every schema
 * that holds text and runs side by side. Coverage problems sit on the `runs` path; a run that
 * starts inside a surrogate pair sits on its own path (`['runs', index]`) and carries
 * `params.boardIssueCode` `'run-splits-character'`, which `importBoard` reports it under.
 *
 * @param value - An object holding `text` and `runs`.
 * @param value.text - The characters the runs cover.
 * @param value.runs - The style runs, in order.
 * @param value.paragraphs - Each paragraph's list style, when given: there must be one
 *   per paragraph.
 * @param context - The refinement context of the schema being checked.
 */
export function refineRuns(
  value: {
    readonly text: string;
    readonly runs: readonly StyleRun[];
    readonly paragraphs?: readonly ParagraphStyle[] | undefined;
  },
  context: z.RefinementCtx,
): void {
  const { paragraphs } = value;
  if (paragraphs !== undefined && paragraphs.length !== paragraphCount(value.text)) {
    const message = `paragraphs has ${String(paragraphs.length)} entries but the text has ${String(paragraphCount(value.text))} paragraphs`;
    context.addIssue({ code: 'custom', path: ['paragraphs'], message, input: paragraphs });
  }
  for (const message of findCoverageIssues(value.text, value.runs)) {
    context.addIssue({ code: 'custom', path: ['runs'], message, input: value.runs });
  }
  const boardIssueCode: BoardIssueCode = 'run-splits-character';
  for (const index of findRunsSplittingCharacters(value.text, value.runs)) {
    context.addIssue({
      code: 'custom',
      path: ['runs', index],
      message: splitCharacterMessage(index),
      input: value.runs[index],
      params: { boardIssueCode },
    });
  }
}

/** The text, runs and paragraphs fields, shared by text objects, stickies and labels. */
export const textContentShape = {
  /** The characters, as a JavaScript (UTF-16) string. */
  text: z.string().describe('The characters, as a JavaScript (UTF-16) string.'),
  /** Style runs covering the text in order; lengths sum to the text length; only empty text has one zero-length run; adjacent runs differ in style; no run boundary falls inside a surrogate pair. */
  runs: z
    .array(styleRunSchema)
    .describe(
      'Style runs covering the text in order; lengths sum to the text length; only empty text has one zero-length run; adjacent runs differ in style; no run boundary falls inside a surrogate pair.',
    ),
  /** Each paragraph's list style, one per paragraph (the text split on '\n'); absent when every paragraph is plain. */
  paragraphs: z
    .array(paragraphStyleSchema)
    .optional()
    .describe(
      "Each paragraph's list style, one entry per paragraph (the text split on '\\n'), each {} (plain) or { list: 'bullet' | 'numbered', level?: 0-3 }; absent when every paragraph is plain.",
    ),
};

/**
 * Validates rich text: characters plus the style runs that cover them, under the run
 * invariant of {@link findRunIssues}, and optionally each paragraph's list style, one
 * per paragraph. Used for shape and connector labels; text objects and
 * stickies hold the same two fields at their top level.
 */
export const textContentSchema = z.strictObject(textContentShape).superRefine(refineRuns);

/** Rich text: characters plus the style runs that cover them. */
export type TextContent = z.output<typeof textContentSchema>;
