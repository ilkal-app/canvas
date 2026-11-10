import type { DocumentStore } from '@canvas/document';
import type { BoardObject, StyleRun } from '@canvas/schema';

import { ensurePageCoverage, ensurePageFont } from './page-fonts.js';
import { CoverageNeedsCache, isSlicedFamily, type CoverageNeed } from './script-coverage.js';

/**
 * Reads text runs from every object with editable text, including shape and connector labels.
 *
 * @param object - A board object.
 * @returns Its text runs, or none.
 */
export function objectFontRuns(object: BoardObject | undefined): readonly StyleRun[] {
  if (object?.type === 'text' || object?.type === 'sticky') return object.runs;
  if (object?.type === 'shape' || object?.type === 'connector') return object.label?.runs ?? [];
  return [];
}

/**
 * Requests only families present on the board, then follows changed objects incrementally.
 *
 * @param store - The board's store.
 * @param ensure - Font loader; injectable for deterministic tests.
 * @param ensureCoverage - Coverage loader, by family or CJK slice; injectable too.
 * @returns Stops following the board.
 */
export function followBoardFonts(
  store: DocumentStore,
  ensure: (family: string) => Promise<boolean> = ensurePageFont,
  ensureCoverage: (need: CoverageNeed) => Promise<boolean> = ensurePageCoverage,
): () => void {
  const requested = new Set<string>();
  // An edited text is read again only where it changed.
  const coverage = new CoverageNeedsCache();
  const follow = (object: BoardObject | undefined) => {
    const text =
      object?.type === 'text' || object?.type === 'sticky'
        ? object.text
        : object?.type === 'shape' || object?.type === 'connector'
          ? (object.label?.text ?? '')
          : '';
    const runs = objectFontRuns(object);
    for (const { style } of runs) {
      // A CJK family a run names is among the coverage needs, by slice.
      if (isSlicedFamily(style.fontFamily) || requested.has(style.fontFamily)) continue;
      requested.add(style.fontFamily);
      void ensure(style.fontFamily);
    }
    // Coverage families as the text needs them: a CJK family by slice.
    for (const need of coverage.needs(text, runs)) {
      // By family, slice and weight: restyling text to bold asks for the bold faces.
      const keys = (need.slices ?? ['']).flatMap((slice) =>
        (need.weights ?? [0]).map(
          (weight) => `${need.family}\u0000${slice}\u0000${String(weight)}`,
        ),
      );
      if (keys.every((key) => requested.has(key))) continue;
      for (const key of keys) requested.add(key);
      void ensureCoverage(need);
    }
  };
  for (const object of store.read().objects.values()) follow(object);
  return store.subscribe((changes) => {
    for (const id of changes.created) follow(store.get(id));
    for (const id of changes.updated) follow(store.get(id));
  });
}
