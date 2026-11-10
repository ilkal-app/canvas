import type { ParagraphStyle, StyleRun } from '@canvas/schema';
import { fontFaceId, fontFaceOf, resolveFontFace } from '@canvas/text';
import { subsetFontMetrics } from '@canvas/text';
import { codepointAt } from '@canvas/text';
import type { TextAlign, TextBaseDirection } from '@canvas/text';

import { coverageRuns } from '../font/coverage-runs.js';
import type { FontLibrary } from '../font/font-library.js';

import type { LayoutJobRequest } from './layout-job-payload.js';

/** What to lay out: a text object's content and box settings. */
export interface LayoutInput {
  /** The text object, echoed in the response. */
  readonly objectId: string;
  /** The characters. */
  readonly text: string;
  /** Style runs covering the text. */
  readonly runs: readonly StyleRun[];
  /** The wrapping width, in world units; `null` for auto-width text. */
  readonly maxWidth: number | null;
  /** Horizontal alignment of each line. */
  readonly align: TextAlign;
  /** The base direction of each paragraph; absent is auto. */
  readonly direction?: TextBaseDirection;
  /** A sticky note's text box height its text is fitted to. */
  readonly fitHeight?: number;
  /** The most lines each paragraph shows. */
  readonly lineCaps?: readonly number[];
  /** One style per paragraph when any is a list. */
  readonly paragraphs?: readonly ParagraphStyle[];
}

/**
 * Builds a `layout` job's request on the engine's thread: resolves each run's face in the font
 * library (with its fallbacks) and attaches the metrics of those faces, each cut to the
 * characters set in it, so a job carries kilobytes rather than whole fonts. The default face
 * leads the list, so a style that names no loaded face resolves the same way in the worker.
 *
 * @param input - The text, runs, width, alignment and direction.
 * @param library - The loaded faces.
 * @returns The request.
 * @throws {RangeError} When the library has no faces.
 */
export function createLayoutJobRequest(input: LayoutInput, library: FontLibrary): LayoutJobRequest {
  const [defaultFace] = library.faces;
  if (defaultFace === undefined) throw new RangeError('Layout needs at least one loaded face.');
  // The default face leads, even when no run uses it, so the worker's last-resort fallback
  // (the first listed face) picks the same face as the library's (its first face).
  const codepointsByFace = new Map<string, Set<number>>([[fontFaceId(defaultFace), new Set()]]);
  const runs = coverageRuns(input.text, input.runs, library);
  let start = 0;
  for (const { length, style } of runs) {
    const faceId = fontFaceId(resolveFontFace(library.faces, fontFaceOf(style)) ?? defaultFace);
    const codepoints = codepointsByFace.get(faceId) ?? new Set<number>();
    for (let index = start; index < start + length;) {
      const character = codepointAt(input.text, index);
      codepoints.add(character.codepoint);
      index += character.length;
    }
    codepointsByFace.set(faceId, codepoints);
    start += length;
  }
  const used = [...codepointsByFace].flatMap(([faceId, codepoints]) => {
    const loaded = library.get(faceId);
    return loaded === undefined ? [] : [{ loaded, codepoints }];
  });
  const fonts = used.map(({ loaded, codepoints }) => subsetFontMetrics(loaded.metrics, codepoints));
  const faces = used.map(({ loaded: { faceId, fontKey } }) => ({ faceId, fontKey }));
  return { ...input, direction: input.direction ?? 'auto', runs, fonts, faces };
}
