import { FontLibrary, type FontFaceSource } from '@canvas/engine';

/**
 * Fetches a font file's bytes.
 *
 * @param url - Where the file is.
 * @returns The bytes.
 */
export type FontFetcher = (url: string) => Promise<ArrayBuffer>;

/**
 * Fetches with the scope's `fetch`, on the page or in a worker.
 *
 * @param url - The file's URL (http(s) or `data:`).
 * @returns The bytes.
 * @throws {Error} When the response is not OK (as a rejection).
 */
export async function fetchFontBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The font ${url} did not load: ${String(response.status)}.`);
  return response.arrayBuffer();
}

/**
 * Loads font files into a library, in the order given, so the first is the default face on
 * every thread (the page's text tool and the engine's text pass must resolve faces alike). The
 * library is returned at once and filled when every file has loaded; a file that fails is
 * reported and left out. Page or worker.
 *
 * @param sources - The files, the default face first.
 * @param onError - Receives a file that failed to load or parse.
 * @param fetchBytes - Fetches a file; the scope's `fetch` by default.
 * @returns The library, and a promise that settles once it is filled.
 */
export function loadFontLibrary(
  sources: readonly FontFaceSource[],
  onError: (error: unknown) => void,
  fetchBytes: FontFetcher = fetchFontBytes,
): { readonly fonts: FontLibrary; readonly loaded: Promise<void> } {
  const fonts = new FontLibrary();
  const loaded = Promise.all(
    sources.map((source) =>
      fetchBytes(source.url).then(
        (bytes) => bytes,
        (error: unknown) => {
          onError(error);
          return undefined;
        },
      ),
    ),
  ).then(async (files) => {
    files.forEach((bytes, index) => {
      const source = sources[index];
      if (bytes === undefined || source === undefined) return;
      const { family, weight, isItalic, postScriptName } = source;
      try {
        // A named face keeps its name.
        const name = postScriptName === undefined ? {} : { postScriptName };
        fonts.addFace({ family, weight, isItalic, ...name }, bytes);
      } catch (error) {
        onError(error);
      }
    });
    await fonts.prepareContentIdentity(sources);
  });
  return { fonts, loaded };
}
