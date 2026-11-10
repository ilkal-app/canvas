import { useEffect, useState } from 'react';

import type { DocumentStore } from '@canvas/document';
import { fontFamilyUsesOf, type ObjectId, type StyleId } from '@canvas/schema';

import type { FontLoadStatus } from './demand-fonts.js';
import { restoreLocalFonts } from './local-fonts.js';
import { ensurePageFont, pageFontStatus, subscribePageFonts } from './page-fonts.js';

// The board's missing fonts as a document state: every family the board names (runs,
// labels, instance overrides, variant presets, text styles; `fontFamilyUsesOf`) whose faces the
// page could not find or load (`missing` or `failed`), kept up to date incrementally: an object's
// or text style's families are read again only when a change set names it, and counted per
// family, so a large board is never walked again while it is edited. A family seen for the first
// time is requested, as `followBoardFonts` does for runs, so a family named only in an override
// or a style gets a status too.

/** Where the tracker reads font statuses and asks for families; the page's by default. */
export interface MissingFontSources {
  /** A family's load status. */
  readonly status: (family: string) => FontLoadStatus;
  /** Follows status changes. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Asks for a family's faces. */
  readonly ensure: (family: string) => Promise<boolean>;
  /**
   * Installs missing families from this computer when the person already allowed it
   * (`restoreLocalFonts`); answers the families installed.
   */
  readonly restoreLocal?: (families: readonly string[]) => Promise<readonly string[]>;
}

/** The page's font statuses and loader. */
export const PAGE_FONT_SOURCES: MissingFontSources = {
  status: pageFontStatus,
  subscribe: subscribePageFonts,
  ensure: ensurePageFont,
  restoreLocal: restoreLocalFonts,
};

/**
 * Whether a family's faces are unavailable: none in the catalogue, or every load failed.
 *
 * @param status - Its load status.
 * @returns True for `missing` and `failed`.
 */
function isUnavailable(status: FontLoadStatus): boolean {
  return status === 'missing' || status === 'failed';
}

/**
 * Counts how many objects and text styles name each family: a source's families are replaced
 * whole when it is read again, so an edit costs its own families, never the board's.
 */
class FamilyCounts {
  readonly #counts = new Map<string, number>();
  readonly #objects = new Map<ObjectId, readonly string[]>();
  readonly #styles = new Map<StyleId, readonly string[]>();

  /**
   * Replaces what an object or a text style names.
   *
   * @param kind - Whether the source is an object or a text style.
   * @param id - The source.
   * @param families - The families it names now, each once; none when it is gone.
   */
  set(kind: 'object', id: ObjectId, families: readonly string[]): void;
  set(kind: 'style', id: StyleId, families: readonly string[]): void;
  set(kind: 'object' | 'style', id: string, families: readonly string[]): void {
    const sources: Map<string, readonly string[]> =
      kind === 'object' ? this.#objects : this.#styles;
    for (const family of sources.get(id) ?? []) {
      const count = (this.#counts.get(family) ?? 0) - 1;
      if (count > 0) this.#counts.set(family, count);
      else this.#counts.delete(family);
    }
    for (const family of families) this.#counts.set(family, (this.#counts.get(family) ?? 0) + 1);
    if (families.length === 0) sources.delete(id);
    else sources.set(id, families);
  }

  /**
   * The families some source names.
   *
   * @returns Each once.
   */
  families(): IterableIterator<string> {
    return this.#counts.keys();
  }
}

/**
 * Follows the board's missing families: calls `onChange` with them, in plain string order, now
 * and whenever the list changes (an object or text style names a new family or no longer names
 * one, or a family's faces load or fail). Each change set costs only the objects and text styles
 * it names, and the distinct families the board names.
 *
 * @param store - The board's store.
 * @param onChange - Receives the missing families.
 * @param sources - The font statuses and loader; the page's by default.
 * @returns Stops following.
 */
export function followMissingBoardFonts(
  store: DocumentStore,
  onChange: (families: readonly string[]) => void,
  sources: MissingFontSources = PAGE_FONT_SOURCES,
): () => void {
  const counts = new FamilyCounts();
  const requested = new Set<string>();
  const restoring = new Set<string>();
  let last: string | undefined;
  // A family no catalogue holds may be installed on this computer: each is offered once to the
  // local restore, which installs it only under a permission already granted.
  const restore = (missing: readonly string[]) => {
    if (sources.restoreLocal === undefined) return;
    const fresh = missing.filter(
      (family) => !restoring.has(family) && sources.status(family) === 'missing',
    );
    if (fresh.length === 0) return;
    for (const family of fresh) restoring.add(family);
    // A listing can still fail under a granted permission; the families then stay missing.
    sources.restoreLocal(fresh).catch(() => undefined);
  };
  const request = (families: readonly string[]) => {
    for (const family of families) {
      if (requested.has(family)) continue;
      requested.add(family);
      void sources.ensure(family);
    }
  };
  const readObject = (id: ObjectId) => {
    const object = store.get(id);
    const families =
      object === undefined
        ? []
        : [...new Set(fontFamilyUsesOf(object).map(({ family }) => family))];
    counts.set('object', id, families);
    request(families);
  };
  const readStyle = (id: StyleId) => {
    const family = store.readTextStyles().get(id)?.value.fontFamily;
    const families = family === undefined ? [] : [family];
    counts.set('style', id, families);
    request(families);
  };
  const report = () => {
    const missing = [...counts.families()]
      .filter((family) => isUnavailable(sources.status(family)))
      .sort();
    restore(missing);
    const key = missing.join('\n');
    if (key === last) return;
    last = key;
    onChange(missing);
  };
  for (const id of store.read().objects.keys()) readObject(id);
  for (const id of store.readTextStyles().keys()) readStyle(id);
  report();
  const stopFonts = sources.subscribe(report);
  const stopStore = store.subscribe((changes) => {
    for (const id of [...changes.created, ...changes.updated, ...changes.deleted]) readObject(id);
    for (const id of changes.textStyles ?? []) readStyle(id);
    report();
  });
  return () => {
    stopFonts();
    stopStore();
  };
}

/**
 * The board's missing families, kept up to date (`followMissingBoardFonts`); none without a
 * store.
 *
 * @param store - The board's store, or undefined.
 * @param sources - The font statuses and loader; the page's by default.
 * @returns The missing families, in plain string order.
 */
export function useMissingBoardFonts(
  store: DocumentStore | undefined,
  sources: MissingFontSources = PAGE_FONT_SOURCES,
): readonly string[] {
  const [missing, setMissing] = useState<readonly string[]>([]);
  useEffect(() => {
    if (store === undefined) {
      setMissing([]);
      return undefined;
    }
    return followMissingBoardFonts(store, setMissing, sources);
  }, [store, sources]);
  return missing;
}
