/**
 * Where a font file is fetched from, given the URL the catalogue names it by. The page's own
 * builds name each file where it is served, so this is the URL unchanged; a host that serves the
 * files elsewhere (the SDK, whose fonts are a package of their own) sets a resolver once.
 *
 * @param url - The URL the catalogue names the file by.
 * @returns The URL to fetch.
 */
export type FontFileResolver = (url: string) => string;

/**
 * The URL unchanged: the page's own builds serve each file where the catalogue names it.
 *
 * @param url - The URL the catalogue names the file by.
 * @returns The same URL.
 */
const AS_NAMED: FontFileResolver = (url) => url;

/** The page's resolver: one per page, as the page's fonts are (`loadPageFonts`). */
let resolveFontFile: FontFileResolver = AS_NAMED;

/**
 * Sets where the page fetches its font files from: the text fonts (`fetchFontBytes`) and the
 * chrome's (`loadChromeFonts`). A file the page has already loaded is kept. Page only.
 *
 * @param resolver - Maps a catalogue URL to the URL to fetch; the URL unchanged if absent.
 */
export function setFontFileResolver(resolver: FontFileResolver = AS_NAMED): void {
  resolveFontFile = resolver;
}

/**
 * The URL to fetch a font file from, by the page's resolver ({@link setFontFileResolver}).
 *
 * @param url - The URL the catalogue names the file by.
 * @returns The URL to fetch.
 */
export function fontFileUrl(url: string): string {
  return resolveFontFile(url);
}
