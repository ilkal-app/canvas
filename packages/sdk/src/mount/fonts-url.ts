/**
 * What the build tells the bundle about its fonts (vite.config.ts, scripts/font-files.ts): the
 * scheme each font file's name carries, and the URL the files load from by default, jsDelivr's
 * copy of `@ilkal/fonts` at the SDK's own version. Absent where the SDK runs unbuilt (its own
 * tests), whose fonts are named where they are served.
 */
declare const CANVAS_SDK_FONTS:
  { readonly scheme: string; readonly defaultUrl: string } | undefined;

/** The build's font settings, or `undefined` unbuilt. */
const BUILT_FONTS = typeof CANVAS_SDK_FONTS === 'undefined' ? undefined : CANVAS_SDK_FONTS;

/**
 * Where the fonts load from when the host gives no `fontsUrl`: jsDelivr's copy of the fonts
 * package at the SDK's version, or `undefined` unbuilt.
 */
export const DEFAULT_FONTS_URL: string | undefined = BUILT_FONTS?.defaultUrl;

/** The scheme a font file's name carries in the built bundle, or `undefined` unbuilt. */
export const FONT_FILE_SCHEME: string | undefined = BUILT_FONTS?.scheme;

/**
 * The folder the font files are served from: a `fontsUrl` resolved against the page's address,
 * as a folder (ending in `/`).
 *
 * @param fontsUrl - The host's `fontsUrl`, absolute or relative to the page.
 * @param pageUrl - The page's address (`document.baseURI`).
 * @returns The folder's absolute URL.
 * @throws {TypeError} When it is not a URL.
 */
export function fontsFolder(fontsUrl: string, pageUrl: string): string {
  const folder = new URL(fontsUrl, pageUrl).href;
  return folder.endsWith('/') ? folder : `${folder}/`;
}

/**
 * Where a font file is fetched from: a name the build gave it (`<scheme><path>`) resolved
 * against the fonts folder; any other URL unchanged. Pure.
 *
 * @param url - The URL the catalogue names the file by.
 * @param scheme - The scheme of the build's names.
 * @param folder - The fonts folder ({@link fontsFolder}).
 * @returns The URL to fetch.
 */
export function fontFileUrl(url: string, scheme: string, folder: string): string {
  return url.startsWith(scheme) ? new URL(url.slice(scheme.length), folder).href : url;
}
