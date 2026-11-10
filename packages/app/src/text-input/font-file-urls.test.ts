import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadChromeFonts, type ChromeFontSet } from '../theme/chrome-fonts.js';

import { fontFileUrl, setFontFileResolver } from './font-file-urls.js';
import { fetchFontBytes } from './load-font-library.js';

afterEach(() => {
  setFontFileResolver();
  vi.unstubAllGlobals();
});

describe('the page font file resolver', () => {
  it('leaves a URL unchanged until a host sets a resolver, and again once it is cleared', () => {
    expect(fontFileUrl('https://example.test/a.ttf')).toBe('https://example.test/a.ttf');
    setFontFileResolver((url) => url.replace('example.test', 'cdn.test'));
    expect(fontFileUrl('https://example.test/a.ttf')).toBe('https://cdn.test/a.ttf');
    setFontFileResolver();
    expect(fontFileUrl('https://example.test/a.ttf')).toBe('https://example.test/a.ttf');
  });

  it('fetches the text fonts where the resolver says, and names that URL when one fails', async () => {
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('missing.ttf')
          ? new Response(null, { status: 404 })
          : new Response(new Uint8Array([1, 2, 3])),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    setFontFileResolver((url) => url.replace('font:', 'https://fonts.test/'));

    expect(new Uint8Array(await fetchFontBytes('font:a.ttf'))).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetch).toHaveBeenCalledWith('https://fonts.test/a.ttf');
    await expect(fetchFontBytes('font:missing.ttf')).rejects.toThrow(
      'The font https://fonts.test/missing.ttf did not load: 404.',
    );
  });

  it("adds the chrome's faces from where the resolver says", () => {
    setFontFileResolver((url) => url.replace('font:', 'https://fonts.test/'));
    const fonts: ChromeFontSet = {
      faces: [{ family: 'Chrome', weight: 400, url: 'font:chrome.woff2' }],
      ui: 'Chrome',
      mono: 'Chrome',
    };
    const sources: string[] = [];
    loadChromeFonts(
      fonts,
      { add: () => undefined } as unknown as FontFaceSet,
      (family, source) => {
        expect(family).toBe('Chrome');
        sources.push(source);
        return { load: () => Promise.resolve() } as unknown as FontFace;
      },
      new WeakMap(),
    );
    expect(sources).toEqual(['url("https://fonts.test/chrome.woff2") format("woff2")']);
  });
});
