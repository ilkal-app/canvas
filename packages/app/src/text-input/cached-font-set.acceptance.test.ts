// Acceptance (Claude): restoring a cached preview's font set on a fresh page. A saved
// identity names the publisher's faces in the order they were installed; the fresh page must
// end with exactly those bytes in exactly that order, however the network answers (the
// families' files are fetched together but installed in the saved order), so the key matches
// and the preview can be verified. Anything else is refused: a key naming an unknown family, a
// key whose bytes differ from this device's, a malformed key, or a restore that is no longer
// wanted; and a refused restore never pretends the page holds the certified set.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { restoreCachedFontSet as RestoreCachedFontSet } from './cached-font-set.js';
import type * as PageFonts from './page-fonts.js';

const DEFAULTS = 'LiberationSans';
const MONO = 'jetbrainsmono';
const SERIF = 'lora';

/** Font files the page asked for, by the path under the fonts directories, in order. */
const fetched: string[] = [];
/**
 * Which attempt of a test is running: bumped when each attempt ends, so an attempt that Vitest
 * timed out and abandoned cannot go on loading fonts into the next attempt's recorder (its body
 * keeps executing after the timeout; every awaited step here checks it still owns the attempt).
 */
let attempt = 0;

/**
 * What an attempt still has in flight: every step it awaits and every font answer it was served.
 * `afterEach` waits for all of it, so a timed-out attempt's loads end before the retry's stubs
 * and recorder exist.
 */
const pending = new Set<Promise<unknown>>();

/**
 * Records work in flight until it settles.
 *
 * @param work - The work.
 * @returns The same work.
 */
function track<T>(work: Promise<T>): Promise<T> {
  pending.add(work);
  const forget = () => {
    pending.delete(work);
  };
  work.then(forget, forget);
  return work;
}

/** Waits until nothing is in flight: work that settles may have started more. */
async function drain(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

/**
 * Awaits a step of the current attempt, and refuses to continue once the attempt has ended.
 *
 * @param work - The step.
 * @returns Its result.
 * @throws {Error} When the attempt ended (timed out) while the step was pending.
 */
async function step<T>(work: Promise<T>): Promise<T> {
  const own = attempt;
  const value = await track(work);
  if (own !== attempt) throw new Error('This attempt ended while a step was pending.');
  return value;
}
/** Family directories whose answers wait until the named directory has all its files served. */
let holdUntilServed:
  { readonly held: string; readonly after: string; readonly count: number } | undefined;
const held: (() => void)[] = [];
/** A file served with another file's bytes (stale bytes on this device). */
let substitute: { readonly path: string; readonly from: string } | undefined;

/**
 * The disk path of a bundled font URL as this environment resolves it (`file:` under Node;
 * jsdom's `/@fs/<path>` and `/assets/fonts/…` otherwise), or undefined for the catalogue.
 *
 * @param url - What the page asked for.
 * @returns The path, or undefined.
 */
function bundledPathOf(url: string): string | undefined {
  const parsed = new URL(url);
  if (parsed.pathname.includes('catalogue.json')) return undefined;
  if (parsed.protocol === 'file:') return fileURLToPath(parsed);
  if (parsed.pathname.startsWith('/@fs/')) return parsed.pathname.slice('/@fs'.length);
  if (parsed.pathname.startsWith('/assets/fonts/')) {
    return [resolve(process.cwd(), 'packages/app'), process.cwd()]
      .map((root) => resolve(root, `.${parsed.pathname}`))
      .find((candidate) => existsSync(candidate));
  }
  return undefined;
}

/**
 * Serves the bundled font files from disk as the page's `fetch` does, in a controlled order.
 *
 * @param url - What the page asked for.
 * @returns The response.
 */
function serveFonts(url: string): Promise<Response> {
  const path = bundledPathOf(url);
  if (path === undefined) {
    fetched.push('catalogue.json');
    return Promise.resolve(new Response(null, { status: 404 }));
  }
  const short = path.slice(path.indexOf('/fonts/') + 7);
  fetched.push(short);
  const source =
    substitute !== undefined && short.endsWith(substitute.path) ? substitute.from : path;
  const answer = () => new Response(readFileSync(source));
  const order = holdUntilServed;
  if (order !== undefined && short.includes(`/${order.held}/`)) {
    return track(
      new Promise<Response>((resolve, reject) => {
        held.push(() => {
          // A file that cannot be read rejects the answer, so `drain` never waits on it.
          try {
            resolve(answer());
          } catch (error: unknown) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      }),
    );
  }
  const response = track(Promise.resolve(answer()));
  if (
    order !== undefined &&
    short.includes(`/${order.after}/`) &&
    fetched.filter((file) => file.includes(`/${order.after}/`)).length === order.count
  ) {
    // The last file of the family that must arrive first is out: release the held family.
    queueMicrotask(() => {
      for (const release of held.splice(0)) release();
    });
  }
  return response;
}

/** A fresh page: its own instance of the page-fonts module, nothing loaded, and its restore. */
interface Page {
  /** The page's fonts module. */
  readonly fonts: typeof PageFonts;
  /** `restoreCachedFontSet` of the same module instance. */
  readonly restore: typeof RestoreCachedFontSet;
}

/**
 * Opens a fresh page: resets the module registry and imports the page's modules again, which
 * re-evaluates the engine and text stack behind them. Only `beforeEach` calls it, so that cost
 * is set-up time, not the test's.
 *
 * @returns The page.
 */
async function openPage(): Promise<Page> {
  vi.resetModules();
  const fonts = await import('./page-fonts.js');
  const { restoreCachedFontSet } = await import('./cached-font-set.js');
  return { fonts, restore: restoreCachedFontSet };
}

/** The page a test saves an identity on, or uses alone; opened fresh for each attempt. */
let pageOne: Page;
/** The fresh page a test restores the saved identity on; opened fresh for each attempt. */
let pageTwo: Page;

/**
 * Moves to page two: what the test counts as fetched starts here.
 *
 * @returns Page two.
 */
function turnToPageTwo(): Page {
  fetched.length = 0;
  return pageTwo;
}

/**
 * The family directory of each loaded face, in the library's order.
 *
 * @param page - The page's module.
 * @returns Directory names (`LiberationSans` for the defaults).
 */
function faceFamilies(page: typeof PageFonts): string[] {
  return page
    .pageTextFonts()
    .faces.map(({ family }) =>
      family === 'Liberation Sans' ? DEFAULTS : family.toLowerCase().replace(/\s+/g, ''),
    );
}

/**
 * Page one: loads the defaults, then two curated families one after the other, and reports the
 * identity that order produced.
 *
 * @param first - The family installed first.
 * @param second - The family installed second.
 * @returns The saved identity.
 */
async function savedIdentityOf(first: string, second: string): Promise<string> {
  const page = pageOne.fonts;
  await step(page.loadPageFonts().loaded);
  expect(await step(page.ensurePageFont(first))).toBe(true);
  expect(await step(page.ensurePageFont(second))).toBe(true);
  const key = page.pageTextFonts().contentIdentity;
  if (key === undefined) throw new Error('Page one has no font identity.');
  return key;
}

// Every test imports the page's modules afresh; the first import also transforms the engine's
// text stack behind page-fonts (seconds on a loaded runner), which is set-up, not the test. One
// import here pays the transform; each test's fresh import then only re-evaluates. That import
// alone takes about 9 s on a laptop (measured 2026-10-13), so it gets its own set-up
// time rather than the 10 s hook default; the tests keep theirs. The file is among a shard's
// first, so the import competes with every worker's first transforms: the whole file took 5 to
// 57 s on CI, 25 s at the median (46 queue and pull-request shards, 2026-10-29/30), and the
// import alone outran 30 s in queue run 41087094978. Two minutes is about twice the
// slowest file seen.
beforeAll(async () => {
  vi.stubGlobal('fetch', serveFonts);
  await Promise.all([import('./page-fonts.js'), import('./cached-font-set.js')]);
  vi.unstubAllGlobals();
}, 120_000);

// Each attempt's two fresh pages are opened here, not in the test: one re-evaluation
// of the modules takes 200–350 ms locally with coverage on, against 20–30 ms for the loads and
// the restore a test makes, and a loaded runner is 5–10× slower. Inside the test's 5 s that was
// two re-evaluations or more, enough to time out (queue run 39526830863). Two pages take about
// 0.6 s locally and 3–6 s on a loaded runner; 30 s is about 10× that.
beforeEach(async () => {
  vi.stubGlobal('fetch', serveFonts);
  pageOne = await openPage();
  pageTwo = await openPage();
  fetched.length = 0;
}, 30_000);

// An attempt that timed out keeps running: it is ended first (its next step throws), its held
// answers are released, and everything it has in flight settles before the next attempt's
// stubs and recorder exist, so a retry starts clean.
afterEach(async () => {
  attempt += 1;
  for (const release of held.splice(0)) release();
  await drain();
  holdUntilServed = undefined;
  substitute = undefined;
  fetched.length = 0;
  vi.unstubAllGlobals();
}, 30_000);

describe('restoring a cached preview’s font set on a fresh page', () => {
  it('installs two families in the saved order although the network completes them reversed', async () => {
    const key = await savedIdentityOf('JetBrains Mono', 'Lora');
    // Page two: JetBrains Mono's files are answered only after every Lora file has arrived.
    holdUntilServed = { held: MONO, after: SERIF, count: 4 };
    const { fonts: page, restore: restoreCachedFontSet } = turnToPageTwo();
    expect(await step(restoreCachedFontSet(key, () => true))).toBe(true);
    expect(page.pageTextFonts().contentIdentity).toBe(key);
    expect(faceFamilies(page)).toEqual([
      ...Array<string>(4).fill(DEFAULTS),
      ...Array<string>(4).fill(MONO),
      ...Array<string>(4).fill(SERIF),
    ]);
    // Both families were fetched together (no family waited for the other's download), and
    // nothing else of the library was asked for.
    const files = fetched.filter((file) => file.endsWith('.ttf'));
    expect(files).toHaveLength(12);
    expect(files.filter((file) => file.includes(`/${MONO}/`))).toHaveLength(4);
    expect(files.filter((file) => file.includes(`/${SERIF}/`))).toHaveLength(4);
    expect(fetched.filter((file) => file === 'catalogue.json')).toEqual([]);
  });

  it('restores CJK slices exactly, in the saved order, without the rest of the family', async () => {
    const one = pageOne.fonts;
    await step(one.loadPageFonts().loaded);
    const need = { family: 'Noto Sans SC', slices: ['base', 'han-0'], weights: [400] } as const;
    expect(await step(one.ensurePageCoverage(need))).toBe(true);
    expect(await step(one.ensurePageFont('Lora'))).toBe(true);
    const key = one.pageTextFonts().contentIdentity;
    if (key === undefined) throw new Error('Page one has no font identity.');
    // Page two: the slices are answered only after every Lora file has arrived.
    holdUntilServed = { held: 'sc', after: SERIF, count: 4 };
    const { fonts: page, restore: restoreCachedFontSet } = turnToPageTwo();
    expect(await step(restoreCachedFontSet(key, () => true))).toBe(true);
    expect(page.pageTextFonts().contentIdentity).toBe(key);
    const slices = fetched.filter((file) => file.includes('/sc/')).sort();
    expect(slices).toEqual(['cjk/sc/400-base.ttf', 'cjk/sc/400-han-0.ttf']);
  });

  it('keeps the saved order when it is the reverse of the first test’s', async () => {
    const key = await savedIdentityOf('Lora', 'JetBrains Mono');
    holdUntilServed = { held: SERIF, after: MONO, count: 4 };
    const { fonts: page, restore: restoreCachedFontSet } = turnToPageTwo();
    expect(await step(restoreCachedFontSet(key, () => true))).toBe(true);
    expect(page.pageTextFonts().contentIdentity).toBe(key);
    expect(faceFamilies(page).slice(4)).toEqual([
      ...Array<string>(4).fill(SERIF),
      ...Array<string>(4).fill(MONO),
    ]);
  });

  it('refuses a key whose bytes differ on this device, and never reports the certified set', async () => {
    const key = await savedIdentityOf('JetBrains Mono', 'Lora');
    substitute = {
      path: `${MONO}/400.ttf`,
      from: resolve(process.cwd(), 'packages/engine/assets/fonts/LiberationSans-Bold.ttf'),
    };
    expect(existsSync(substitute.from)).toBe(true);
    const { fonts: page, restore: restoreCachedFontSet } = turnToPageTwo();
    expect(await step(restoreCachedFontSet(key, () => true))).toBe(false);
    expect(page.pageTextFonts().contentIdentity).not.toBe(key);
  });

  it('refuses a key naming a family this page cannot load, downloading no family for it', async () => {
    const { fonts: page, restore: restoreCachedFontSet } = pageOne;
    await step(page.loadPageFonts().loaded);
    const defaults = page.pageTextFonts().contentIdentity;
    const privateKey = `font-set:v1:${JSON.stringify([
      ['400|n|Liberation Sans', 'f'.repeat(64)],
      ['400|n|Private Mono', 'a'.repeat(64)],
    ])}`;
    expect(await step(restoreCachedFontSet(privateKey, () => true))).toBe(false);
    // Without an assets service there is no catalogue to consult; with one, the private family
    // would still not be in it. Either way no family file is downloaded for the key.
    expect(fetched.filter((file) => file.endsWith('.ttf'))).toHaveLength(4);
    expect(page.pageTextFonts().contentIdentity).toBe(defaults);
  });

  it('refuses malformed keys without fetching anything', async () => {
    const { fonts: page, restore: restoreCachedFontSet } = pageOne;
    await step(page.loadPageFonts().loaded);
    const before = fetched.length;
    for (const key of [
      'font-set:v2:[]',
      'font-set:v1:[]',
      'font-set:v1:not json',
      `font-set:v1:${JSON.stringify([['400|n|Lora', 'not-a-hash']])}`,
      `font-set:v1:${JSON.stringify([['450|n|Lora', 'a'.repeat(64)]])}`,
      `font-set:v1:${JSON.stringify([
        ['400|n|Lora', 'a'.repeat(64)],
        ['400|n|Lora', 'b'.repeat(64)],
      ])}`,
    ]) {
      expect(await step(restoreCachedFontSet(key, () => true)), key).toBe(false);
    }
    expect(fetched.length).toBe(before);
  });

  it('stops without loading when the preview is no longer wanted', async () => {
    const key = await savedIdentityOf('JetBrains Mono', 'Lora');
    const { fonts: page, restore: restoreCachedFontSet } = turnToPageTwo();
    await step(page.loadPageFonts().loaded);
    const before = fetched.length;
    expect(await step(restoreCachedFontSet(key, () => false))).toBe(false);
    expect(fetched.length).toBe(before);
    expect(faceFamilies(page)).toEqual(Array<string>(4).fill(DEFAULTS));
    // Cancelled after the families were requested: the key is still not reported as restored.
    let isActive = true;
    const restoring = restoreCachedFontSet(key, () => isActive);
    isActive = false;
    expect(await step(restoring)).toBe(false);
  });
});
