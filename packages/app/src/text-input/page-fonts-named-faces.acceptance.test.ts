import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as PageFonts from './page-fonts.js';
// The page-fonts module's whole graph (the engine's root behind it) is transformed while the file
// is collected, which no hook or test timeout counts: a cold transform took over 30 s on a
// loaded queue shard. Each test's fresh import then only re-evaluates it (about 0.2 s).
import './page-fonts.js';

/**
 * Serves a bundled font when page loading starts.
 *
 * @param url - Bundled font file URL.
 * @returns Its response.
 */
function serveFile(url: string): Promise<Response> {
  return Promise.resolve(new Response(readFileSync(fileURLToPath(url))));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('page named faces', () => {
  it('reads without starting the page loader and publishes local installation', async () => {
    vi.resetModules();
    const fetched = vi.fn(serveFile);
    vi.stubGlobal('fetch', fetched);
    const page = (await import('./page-fonts.js')) as typeof PageFonts & {
      pageNamedFaces(family: string): readonly string[];
    };
    expect(page.pageNamedFaces('Private Sans')).toEqual([]);
    expect(fetched).not.toHaveBeenCalled();
    const changed = vi.fn();
    const stop = page.subscribePageFonts(changed);
    await page.loadPageFonts().loaded;
    changed.mockClear();
    const bytes = readFileSync(
      new URL('../../../engine/assets/fonts/LiberationSans-Bold.ttf', import.meta.url),
    );
    page.pageFontLoader().installLocal('Private Sans', [
      {
        face: {
          family: 'Private Sans',
          weight: 700,
          isItalic: false,
          postScriptName: 'PrivateSans-Condensed',
        },
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      },
    ]);
    expect(page.pageNamedFaces('Private Sans')).toEqual(['PrivateSans-Condensed']);
    expect(changed).toHaveBeenCalled();
    stop();
  }, 30_000);
});
