// OffscreenAtlasTexts: off-screen text an atlas change made stale waits for view.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { OffscreenAtlasTexts } from './offscreen-atlas-texts.js';
import type { VisibleObjects } from './text-tier-checks.js';

/**
 * Object ids.
 *
 * @param ids - The ids.
 * @returns They, typed.
 */
function idsOf(...ids: readonly string[]): ObjectId[] {
  return ids as ObjectId[];
}

/**
 * A visible set at a revision.
 *
 * @param revision - Its revision.
 * @param visibleIds - What it holds; `undefined` for everything.
 * @param enteredIds - What entered it at this revision.
 * @returns The set.
 */
function visibleAt(
  revision: number,
  visibleIds: readonly string[] | undefined,
  enteredIds: readonly string[] = [],
): VisibleObjects {
  const set = new Set(visibleIds);
  return {
    visibleRevision: revision,
    visibleIds: visibleIds === undefined ? undefined : idsOf(...visibleIds),
    enteredIds: idsOf(...enteredIds),
    isVisible: (id) => visibleIds === undefined || set.has(id),
  };
}

const ENTRIES = new Map(idsOf('a', 'b', 'c', 'd').map((id) => [id, {}] as const));
const ALL_MAY_WAIT = (): boolean => true;

/**
 * One call's stale set.
 *
 * @param texts - The tracker.
 * @param changed - The texts the atlas change made stale.
 * @param visible - The visible set.
 * @param entries - The pass's text.
 * @param mayWait - Which may wait.
 * @returns The texts to rewrite now, sorted.
 */
function take(
  texts: OffscreenAtlasTexts,
  changed: readonly string[],
  visible: VisibleObjects,
  entries: ReadonlyMap<ObjectId, unknown> = ENTRIES,
  mayWait: (id: ObjectId) => boolean = ALL_MAY_WAIT,
): string[] {
  const stale = new Set<ObjectId>();
  texts.take(new Set(idsOf(...changed)), visible, stale, entries, mayWait);
  return [...stale].sort();
}

describe('OffscreenAtlasTexts', () => {
  it('rewrites visible text at once and the rest when it enters view', () => {
    const texts = new OffscreenAtlasTexts();
    expect(take(texts, ['a', 'b'], visibleAt(1, ['a']))).toEqual(['a']);
    expect(take(texts, [], visibleAt(1, ['a']))).toEqual([]);
    expect(take(texts, [], visibleAt(2, ['a', 'b'], ['b']))).toEqual(['b']);
    expect(take(texts, [], visibleAt(3, ['b']))).toEqual([]);
  });

  it('walks the waiting texts, or the visible set, after the set changed more than once', () => {
    const fewWaiting = new OffscreenAtlasTexts();
    take(fewWaiting, ['b'], visibleAt(1, ['a']));
    // Two revisions on: the one waiting text is checked against the set.
    expect(take(fewWaiting, [], visibleAt(3, ['a', 'b', 'c']))).toEqual(['b']);
    const manyWaiting = new OffscreenAtlasTexts();
    take(manyWaiting, ['b', 'c', 'd'], visibleAt(1, ['a']));
    // More waiting than visible: the visible set is walked instead.
    expect(take(manyWaiting, [], visibleAt(4, ['c']))).toEqual(['c']);
    expect(take(manyWaiting, [], visibleAt(5, ['b', 'd'], ['b', 'd']))).toEqual(['b', 'd']);
  });

  it('rewrites everything, waiting text too, when every object is visible', () => {
    const texts = new OffscreenAtlasTexts();
    take(texts, ['b'], visibleAt(1, ['a']));
    expect(take(texts, ['c'], visibleAt(2, undefined))).toEqual(['b', 'c']);
    expect(take(texts, [], visibleAt(3, ['a', 'b']))).toEqual([]);
  });

  it('rewrites at once text that may not wait for view', () => {
    const texts = new OffscreenAtlasTexts();
    const mayWait = (id: ObjectId): boolean => id !== 'label';
    const entries = new Map(idsOf('label', 'b').map((id) => [id, {}] as const));
    expect(take(texts, ['label', 'b'], visibleAt(1, []), entries, mayWait)).toEqual(['label']);
  });

  it('drops waiting text deleted from the pass once it outnumbers the pass', () => {
    const texts = new OffscreenAtlasTexts();
    take(texts, ['a', 'b', 'c'], visibleAt(1, []));
    const fewer = new Map(idsOf('a').map((id) => [id, {}] as const));
    take(texts, [], visibleAt(1, []), fewer);
    // Only 'a' still waits: entering view hands back no deleted text.
    expect(take(texts, [], visibleAt(2, ['a', 'b', 'c'], ['a', 'b', 'c']), fewer)).toEqual(['a']);
  });

  it('forgets a deleted waiting text at once, so a text given its id later waits for no change', () => {
    const texts = new OffscreenAtlasTexts();
    take(texts, ['a', 'b'], visibleAt(1, []));
    texts.forget('b' as ObjectId);
    // 'b' is back (an undo) and enters view: only 'a' was still waiting.
    expect(take(texts, [], visibleAt(2, ['a', 'b'], ['a', 'b']))).toEqual(['a']);
  });
});
