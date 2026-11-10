import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FontLibrary, fontFaceId } from '@canvas/engine';
import type { TextStyle } from '@canvas/schema';

import { DEFAULT_TEXT_STYLE } from './font-catalogue.js';
import { fetchFontBytes } from './load-font-library.js';
import type * as PageFonts from './page-fonts.js';

const STYLE: TextStyle = DEFAULT_TEXT_STYLE;
const INPUT = {
  text: 'Hello',
  runs: [{ length: 5, style: STYLE }],
  wrapWidth: null,
  align: 'left',
} as const;

/**
 * Serves `file:` URLs from disk, as the page's `fetch` serves the bundled font files.
 *
 * @param url - The file's URL.
 * @returns The response.
 */
function serveFile(url: string): Promise<Response> {
  return Promise.resolve(new Response(readFileSync(fileURLToPath(url))));
}

/**
 * How long evaluating the page-fonts module afresh may take, in a hook and never in a test's own
 * timeout: about 0.25 s locally with coverage on, about 3 s on a loaded queue runner
 * (the file took 16× its local time there), so about 10× the runner's time.
 */
const FRESH_MODULE_TIMEOUT_MS = 30_000;

/**
 * Every font load a test started. The next test waits for them: a load that a timed-out
 * attempt left running would otherwise report into its retry's spies, or fetch unstubbed.
 */
const startedLoads: Promise<void>[] = [];

/**
 * The page-fonts module, fresh: its library is loaded once per page. Its `loadPageFonts` records
 * each load it starts, for the next test to wait for.
 *
 * @returns The module.
 */
async function freshPageFonts(): Promise<typeof PageFonts> {
  vi.resetModules();
  const pageFonts = await import('./page-fonts.js');
  return {
    ...pageFonts,
    loadPageFonts: () => {
      const handle = pageFonts.loadPageFonts();
      startedLoads.push(handle.loaded);
      return handle;
    },
  };
}

afterEach(async () => {
  await Promise.allSettled(startedLoads.splice(0));
  vi.unstubAllGlobals();
}, FRESH_MODULE_TIMEOUT_MS);

describe('the page fonts', () => {
  let page: typeof PageFonts;
  beforeEach(async () => {
    page = await freshPageFonts();
  }, FRESH_MODULE_TIMEOUT_MS);

  it('lays nothing out before anything loads the fonts, then lays out with them', async () => {
    vi.stubGlobal('fetch', serveFile);
    const { PAGE_TEXT_LAYOUT, loadPageFonts } = page;
    expect(PAGE_TEXT_LAYOUT.layout(INPUT)).toBeUndefined();
    const first = loadPageFonts();
    expect(loadPageFonts()).toBe(first);
    expect(PAGE_TEXT_LAYOUT.layout(INPUT)).toBeUndefined();
    await first.loaded;
    const layout = PAGE_TEXT_LAYOUT.layout(INPUT);
    expect(layout?.lines).toHaveLength(1);
    expect(layout?.width).toBeGreaterThan(0);
  });

  it('answers a repeated input with its last layout until the input or the fonts change', async () => {
    vi.stubGlobal('fetch', serveFile);
    const { PAGE_TEXT_LAYOUT, loadPageFonts } = page;
    const { fonts, loaded } = loadPageFonts();
    await loaded;
    const layout = PAGE_TEXT_LAYOUT.layout(INPUT);
    expect(PAGE_TEXT_LAYOUT.layout({ ...INPUT })).toBe(layout);
    // Equal runs read back from the document: a new array, the same layout.
    expect(PAGE_TEXT_LAYOUT.layout({ ...INPUT, runs: [{ ...INPUT.runs[0] }] })).toBe(layout);
    const longer = { ...INPUT, text: 'Hello!', runs: [{ length: 6, style: STYLE }] };
    expect(PAGE_TEXT_LAYOUT.layout(longer)).not.toBe(layout);
    expect(PAGE_TEXT_LAYOUT.layout({ ...INPUT, wrapWidth: 10 })).not.toBe(layout);
    const bold = { ...INPUT.runs[0], style: { ...STYLE, weight: 700 } } as const;
    expect(PAGE_TEXT_LAYOUT.layout({ ...INPUT, runs: [bold] })).not.toBe(layout);
    const again = PAGE_TEXT_LAYOUT.layout(INPUT);
    expect(again).not.toBe(layout);
    expect(again).toEqual(layout);
    const face = fonts.faces[0];
    const bytes = face && fonts.jobResource(fontFaceId(face))?.bytes;
    if (face === undefined || bytes === undefined) throw new Error('no face loaded');
    fonts.addFace({ ...face, family: 'Another' }, bytes.slice(0));
    expect(PAGE_TEXT_LAYOUT.layout(INPUT)).not.toBe(again);
  });

  it('settles whenReady once the page’s fonts have loaded, never starting the load itself', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      fetched.push(url);
      return serveFile(url);
    });
    const { PAGE_TEXT_LAYOUT, loadPageFonts } = page;
    let isReady = false;
    void PAGE_TEXT_LAYOUT.whenReady?.().then(() => {
      isReady = true;
    });
    await Promise.resolve();
    expect(fetched).toEqual([]);
    expect(isReady).toBe(false);
    await loadPageFonts().loaded;
    await Promise.resolve();
    expect(isReady).toBe(true);
    expect(PAGE_TEXT_LAYOUT.layout(INPUT)).toBeDefined();
  });

  describe('on a page whose fonts fail to load', () => {
    // A second page: its module loaded too, so neither load waits on an import.
    let again: typeof PageFonts;
    beforeEach(async () => {
      again = await freshPageFonts();
    }, FRESH_MODULE_TIMEOUT_MS);

    it('reports a font that fails to load to the page, where it can', async () => {
      vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 404 })));
      const reported = vi.fn();
      vi.stubGlobal('reportError', reported);
      await page.loadPageFonts().loaded;
      expect(reported).toHaveBeenCalledTimes(4);
      vi.stubGlobal('reportError', undefined);
      await again.loadPageFonts().loaded;
      expect(reported).toHaveBeenCalledTimes(4);
    });
  });

  it('shares one library, fetched once, between the text tool and a main-thread engine host', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      fetched.push(url);
      return serveFile(url);
    });
    const { loadPageFonts, pageTextFonts } = page;
    const engineFonts = pageTextFonts();
    expect(loadPageFonts().fonts).toBe(engineFonts);
    expect(pageTextFonts()).toBe(engineFonts);
    await loadPageFonts().loaded;
    expect(fetched).toHaveLength(4);
    expect(new Set(fetched).size).toBe(4);
    expect(fetched.every((url) => !url.startsWith('data:'))).toBe(true);
  });

  it('answers nothing from an empty library', () => {
    const { createFontLayoutService } = page;
    expect(createFontLayoutService(new FontLibrary()).layout(INPUT)).toBeUndefined();
  });
});

describe('fetchFontBytes', () => {
  it('fetches a file’s bytes and refuses a failed response', async () => {
    vi.stubGlobal('fetch', (url: string) =>
      Promise.resolve(
        url === 'ok' ? new Response(new Uint8Array([1, 2])) : new Response(null, { status: 500 }),
      ),
    );
    expect(new Uint8Array(await fetchFontBytes('ok'))).toEqual(new Uint8Array([1, 2]));
    await expect(fetchFontBytes('gone')).rejects.toThrow('The font gone did not load: 500.');
  });
});
