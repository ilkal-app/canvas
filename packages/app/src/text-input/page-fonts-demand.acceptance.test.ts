// / acceptance (Claude), the page's font loading end to end over a fresh module
// and a `fetch` that serves the bundled files from disk: startup downloads only the default
// family's four files; a used family downloads exactly its own files; a family the catalogue
// does not know loads its hinted library fallback (by name) and is reported missing, not
// rewritten; the self-hosted catalogue is consulted once, retried on request, and its families
// become loadable; a family installed from local bytes is ready with no network request at all.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TextStyle } from '@canvas/schema';

import { DEFAULT_TEXT_STYLE } from './font-catalogue.js';
import type * as PageFonts from './page-fonts.js';
// The page-fonts module's whole graph (the engine's root behind it) is transformed while the file
// is collected, which no hook or test timeout counts: a cold transform took over 30 s on a
// loaded queue shard. Each test's fresh import then only re-evaluates it (about 0.2 s).
import './page-fonts.js';

const LIBERATION_REGULAR = new URL(
  '../../../engine/assets/fonts/LiberationSans-Regular.ttf',
  import.meta.url,
);
const CATALOGUE_URL = '/assets/fonts/catalogue.json';

/** Every request `fetch` saw, in order. */
let fetched: string[] = [];
/** How the stub answers the catalogue request: a status, or a body. */
let catalogueAnswer: { readonly status: number } | { readonly json: unknown } = { status: 404 };

/**
 * Serves bundled `file:` URLs from disk, the catalogue as configured, and a catalogue family's
 * file (`/assets/fonts/<slug>/<face>.ttf`) with Liberation Sans bytes.
 *
 * @param url - What the page asked for.
 * @returns The response.
 */
function serve(url: string): Promise<Response> {
  fetched.push(url);
  if (url === CATALOGUE_URL) {
    return Promise.resolve(
      'json' in catalogueAnswer
        ? Response.json(catalogueAnswer.json)
        : new Response(null, { status: catalogueAnswer.status }),
    );
  }
  if (url.startsWith('/assets/fonts/')) {
    return Promise.resolve(new Response(readFileSync(LIBERATION_REGULAR)));
  }
  return Promise.resolve(new Response(readFileSync(fileURLToPath(url))));
}

/**
 * The page-fonts module, fresh: its library and loader are per page.
 *
 * @returns The module.
 */
async function freshPageFonts(): Promise<typeof PageFonts> {
  vi.resetModules();
  fetched = [];
  catalogueAnswer = { status: 404 };
  vi.stubGlobal('fetch', serve);
  return import('./page-fonts.js');
}

/**
 * A one-run layout input in a family.
 *
 * @param fontFamily - The family.
 * @param weight - Regular or bold.
 * @returns The input.
 */
function inputIn(fontFamily: string, weight: 400 | 700 = 400) {
  const style: TextStyle = { ...DEFAULT_TEXT_STYLE, fontFamily, weight };
  return { text: 'Hello', runs: [{ length: 5, style }], wrapWidth: null, align: 'left' } as const;
}

/**
 * The font files requested so far, by the family directory in their URL.
 *
 * @param slug - A family directory (`lora`) or file name part (`LiberationSans`).
 * @returns How many requests named it.
 */
function requestsFor(slug: string): number {
  return fetched.filter((url) => url.includes(`/${slug}/`) || url.includes(`/${slug}-`)).length;
}

/**
 * Which attempt of a test is running: bumped when each attempt ends, so an attempt that Vitest
 * timed out and abandoned cannot go on loading fonts into the next attempt's `fetched` (its body
 * keeps executing after the timeout; every awaited step here checks it still owns the attempt).
 * The pattern is cached-font-set.acceptance.test.ts's.
 */
let attempt = 0;

/** What the attempt still has in flight: every step it awaits. `afterEach` waits for all of it. */
const pending = new Set<Promise<unknown>>();

/**
 * Awaits a step of the current attempt, and refuses to continue once the attempt has ended.
 *
 * @param work - The step.
 * @returns Its result.
 * @throws {Error} When the attempt ended (timed out) while the step was pending.
 */
async function step<T>(work: Promise<T>): Promise<T> {
  const own = attempt;
  pending.add(work);
  const forget = () => {
    pending.delete(work);
  };
  work.then(forget, forget);
  const value = await work;
  if (own !== attempt) throw new Error('This attempt ended while a step was pending.');
  return value;
}

/** This attempt's fresh page-fonts module. */
let page: typeof PageFonts;

// Each attempt's fresh module is imported here, not in the test (as did for
// cached-font-set): one re-evaluation of the engine graph takes about 0.2 s locally and many times
// that on a loaded queue shard, which with the loads outran a test's 5 s (queue run 41093799225).
// 30 s is far more than any re-evaluation seen.
beforeEach(async () => {
  page = await freshPageFonts();
}, 30_000);

// An attempt that timed out keeps running: it is ended (its next step throws) and every step it
// has in flight settles before `fetch` is unstubbed and the retry's fresh module exists. A step
// that settles may start no other: the body stops at the step that throws.
afterEach(async () => {
  attempt += 1;
  while (pending.size > 0) await Promise.allSettled([...pending]);
  vi.unstubAllGlobals();
}, 30_000);

describe('on-demand page fonts', () => {
  it('downloads only the default family’s four files at startup', async () => {
    const { loadPageFonts, pageFontStatus } = page;
    await step(loadPageFonts().loaded);
    expect(fetched).toHaveLength(4);
    expect(fetched.every((url) => url.includes('LiberationSans-'))).toBe(true);
    expect(pageFontStatus('Liberation Sans')).toBe('ready');
    expect(pageFontStatus('Lora')).toBe('idle');
    expect(pageFontStatus('Caveat')).toBe('idle');
  });

  it('downloads exactly a used family’s own files when it is requested, then lays out with them', async () => {
    const { loadPageFonts, ensurePageFont, pageFontStatus, PAGE_TEXT_LAYOUT, pageTextFonts } = page;
    await step(loadPageFonts().loaded);
    const before = fetched.length;
    expect(await step(ensurePageFont('Lora'))).toBe(true);
    const added = fetched.slice(before);
    expect(added).toHaveLength(4);
    expect(added.every((url) => url.includes('/lora/'))).toBe(true);
    expect(pageFontStatus('Lora')).toBe('ready');
    expect(fetched.filter((url) => url === CATALOGUE_URL)).toEqual([]);
    expect(
      pageTextFonts().resolve({ family: 'Lora', weight: 700, isItalic: true })?.face,
    ).toMatchObject({ family: 'Lora', weight: 700, isItalic: true });
    expect(PAGE_TEXT_LAYOUT.layout(inputIn('Lora', 700))?.lines).toHaveLength(1);
    // Asking again downloads nothing.
    expect(await step(ensurePageFont('Lora'))).toBe(true);
    expect(fetched).toHaveLength(before + 4);
    // The default faces stayed the default on the engine side.
    expect(pageTextFonts().faces[0]).toMatchObject({
      family: 'Liberation Sans',
      weight: 400,
      isItalic: false,
    });
  });

  it('loads a family with only a regular face as that one file, and keeps weight requests in-family', async () => {
    const { loadPageFonts, ensurePageFont, pageTextFonts } = page;
    await step(loadPageFonts().loaded);
    const before = fetched.length;
    expect(await step(ensurePageFont('Bebas Neue'))).toBe(true);
    expect(fetched.slice(before)).toHaveLength(1);
    expect(requestsFor('bebasneue')).toBe(1);
    // A bold request for a regular-only family degrades inside the family, not to the default.
    expect(
      pageTextFonts().resolve({ family: 'Bebas Neue', weight: 700, isItalic: false })?.face,
    ).toMatchObject({ family: 'Bebas Neue', weight: 400, isItalic: false });
  });
});

describe('a family this page cannot load', () => {
  it('is reported missing, consults the catalogue once, and loads only its hinted fallback', async () => {
    const { loadPageFonts, ensurePageFont, pageFontStatus, pageTextFonts, PAGE_TEXT_LAYOUT } = page;
    await step(loadPageFonts().loaded);
    const before = fetched.length;
    expect(await step(ensurePageFont('Private Mono'))).toBe(false);
    expect(pageFontStatus('Private Mono')).toBe('missing');
    const added = fetched.slice(before);
    expect(added.filter((url) => url === CATALOGUE_URL)).toHaveLength(1);
    const files = added.filter((url) => url !== CATALOGUE_URL);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((url) => url.includes('/jetbrainsmono/'))).toBe(true);
    // The fallback keeps the requested weight; the stored family name is untouched.
    expect(
      pageTextFonts().resolve({ family: 'Private Mono', weight: 700, isItalic: false })?.face,
    ).toMatchObject({ family: 'JetBrains Mono', weight: 700, isItalic: false });
    const layout = PAGE_TEXT_LAYOUT.layout(inputIn('Private Mono', 700));
    expect(layout?.lines).toHaveLength(1);
    expect(pageFontStatus('Private Mono')).toBe('missing');
    // Asking again does not consult the catalogue again.
    expect(await step(ensurePageFont('Private Mono'))).toBe(false);
    expect(fetched.filter((url) => url === CATALOGUE_URL)).toHaveLength(1);
  });

  it('falls back to the default sans for an unknown name without any further download', async () => {
    const { loadPageFonts, ensurePageFont, pageFontStatus, pageTextFonts } = page;
    await step(loadPageFonts().loaded);
    const before = fetched.length;
    expect(await step(ensurePageFont('Zzyzx Private'))).toBe(false);
    expect(pageFontStatus('Zzyzx Private')).toBe('missing');
    expect(fetched.slice(before)).toEqual([CATALOGUE_URL]);
    expect(
      pageTextFonts().resolve({ family: 'Zzyzx Private', weight: 700, isItalic: true })?.face,
    ).toMatchObject({ family: 'Liberation Sans', weight: 700, isItalic: true });
  });

  it('becomes ready from local bytes with no network request, and announces the change', async () => {
    const { loadPageFonts, pageFontLoader, pageFontStatus, subscribePageFonts, PAGE_TEXT_LAYOUT } =
      page;
    await step(loadPageFonts().loaded);
    const before = fetched.length;
    const changed = vi.fn();
    subscribePageFonts(changed);
    const bytes = readFileSync(LIBERATION_REGULAR);
    pageFontLoader().installLocal('Private Mono', [
      {
        face: { family: 'Private Mono', weight: 400, isItalic: false },
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      },
    ]);
    expect(pageFontStatus('Private Mono')).toBe('ready');
    expect(changed).toHaveBeenCalled();
    expect(PAGE_TEXT_LAYOUT.layout(inputIn('Private Mono'))?.lines).toHaveLength(1);
    expect(fetched.slice(before)).toEqual([]);
  });
});

describe('the self-hosted catalogue', () => {
  it('answers no families while the owner has not uploaded it, and retries only when asked', async () => {
    const { loadPageFonts, loadRemoteFontCatalogue } = page;
    await step(loadPageFonts().loaded);
    expect(await step(loadRemoteFontCatalogue())).toEqual([]);
    expect(await step(loadRemoteFontCatalogue())).toEqual([]);
    expect(fetched.filter((url) => url === CATALOGUE_URL)).toHaveLength(1);
    catalogueAnswer = {
      json: {
        version: 1,
        entries: [
          {
            family: 'Example Serif',
            category: 'serif',
            licence: 'OFL-1.1',
            faces: [
              { weight: 400, isItalic: false, url: 'exampleserif/400.ttf' },
              { weight: 700, isItalic: false, url: 'exampleserif/700.ttf' },
            ],
          },
        ],
      },
    };
    const entries = await step(loadRemoteFontCatalogue(true));
    expect(fetched.filter((url) => url === CATALOGUE_URL)).toHaveLength(2);
    expect(entries.map(({ family, category }) => ({ family, category }))).toEqual([
      { family: 'Example Serif', category: 'serif' },
    ]);
    // Listing the catalogue downloads no font file.
    expect(fetched.filter((url) => url.includes('exampleserif'))).toEqual([]);
  });

  it('loads a catalogue family from the assets service’s own prefix only', async () => {
    const { loadPageFonts, loadRemoteFontCatalogue, ensurePageFont, pageFontStatus } = page;
    await step(loadPageFonts().loaded);
    catalogueAnswer = {
      json: {
        version: 1,
        entries: [
          {
            family: 'Example Serif',
            category: 'serif',
            licence: 'OFL-1.1',
            faces: [{ weight: 400, isItalic: false, url: 'exampleserif/400.ttf' }],
          },
        ],
      },
    };
    await step(loadRemoteFontCatalogue());
    expect(pageFontStatus('Example Serif')).toBe('idle');
    expect(await step(ensurePageFont('Example Serif'))).toBe(true);
    expect(pageFontStatus('Example Serif')).toBe('ready');
    expect(fetched.filter((url) => url.includes('exampleserif'))).toEqual([
      '/assets/fonts/exampleserif/400.ttf',
    ]);
  });
});
