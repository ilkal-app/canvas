import {
  createLayoutJobRequest,
  layoutTextNow,
  libraryShaping,
  fallbackFamily,
  type FontLibrary,
  preloadLayoutShaper,
  fontFaceId,
} from '@canvas/engine';
import { createTextShaping, type Shaper, type TextLayout, type TextShaping } from '@canvas/text';
import type { TextLayoutService } from '@canvas/tools';

import type { OverrideSizeFollowerOptions } from '../engine/override-size-follower.js';

import { COVERAGE_FONT_FAMILIES } from './coverage-fonts.js';
import { DemandFonts, type FontLoadStatus } from './demand-fonts.js';
import { FONT_FACE_SOURCES, FONT_FAMILIES, type FontFamilyEntry } from './font-catalogue.js';
import { loadFontLibrary } from './load-font-library.js';
import { fetchFontCatalogue, fontCatalogueBase } from './remote-font-catalogue.js';
import { CoverageNeedsCache, isSlicedFamily, type CoverageNeed } from './script-coverage.js';

/**
 * Reports a font file that failed to load as an uncaught error of the page, where the page has
 * `reportError` (test environments may not).
 *
 * @param error - What failed.
 */
function reportFontError(error: unknown): void {
  (globalThis as Partial<typeof globalThis>).reportError?.(error);
}

/** The page's font library and when it has loaded, shared by every canvas on the page. */
let demand: DemandFonts | undefined;
const FONT_LISTENERS = new Set<() => void>();

let pageFonts: { readonly fonts: FontLibrary; readonly loaded: Promise<void> } | undefined;

/** The page's shaper, loaded with its fonts: the page lays text out shaped. */
let pageShaper: Shaper | undefined;
let pageShaping: TextShaping | undefined;

// Settles the promise below; called once the page's fonts have loaded.
let settlePageFontsReady!: () => void;

/** Settles once the page's fonts have loaded, whenever something starts loading them. */
const pageFontsReady = new Promise<void>((resolve) => {
  settlePageFontsReady = resolve;
});

/**
 * The page's fonts: the catalogue's files, loaded once per page for the text tool's layout (the
 * engine loads the same files where it renders), and the shaper the page lays text out with.
 * Page only.
 *
 * @returns The library, filled once `loaded` settles, which is also when the shaper has loaded.
 */
export function loadPageFonts(): { readonly fonts: FontLibrary; readonly loaded: Promise<void> } {
  if (pageFonts === undefined) {
    const library = loadFontLibrary(FONT_FACE_SOURCES, reportFontError);
    demand = new DemandFonts(library.fonts, [...FONT_FAMILIES, ...COVERAGE_FONT_FAMILIES]);
    demand.subscribe(() => {
      for (const listener of FONT_LISTENERS) listener();
    });
    // The engine's layout shaper too, on the main-thread host's thread.
    const shaperLoaded = preloadLayoutShaper().then((shaper) => {
      pageShaper = shaper;
    });
    // Loaded means ready to lay out: the fonts and the shaper both.
    const loaded = Promise.all([library.loaded, shaperLoaded]).then(() => {
      settlePageFontsReady();
      for (const listener of FONT_LISTENERS) listener();
    });
    pageFonts = { fonts: library.fonts, loaded };
  }
  return pageFonts;
}

/**
 * The main-thread engine host's text fonts (`createTextResources`): the page's own library, so
 * the font files are fetched and parsed once for the text tool and the engine together. Loads
 * the page's fonts if nothing has yet. Page only.
 *
 * @returns The page's library.
 */
export function pageTextFonts(): FontLibrary {
  return loadPageFonts().fonts;
}

/**
 * The page's text shaping, for measuring override sizes as MCP does: over the faces
 * the page has loaded, each file read when text is first shaped with it, so a face not loaded
 * yet throws `MissingFontFileError` (load its family, then measure again). Faces are kept by id
 * once read: the page never loads other bytes under a face id it has.
 *
 * @returns The shaping, or `undefined` until the page's fonts and shaper have loaded.
 */
export function pageTextShaping(): TextShaping | undefined {
  const fonts = pageFonts?.fonts;
  if (fonts === undefined || pageShaper === undefined) return undefined;
  pageShaping ??= createTextShaping(
    pageShaper,
    {
      bytesOf: (face) => {
        const loaded = fonts.get(fontFaceId(face));
        return loaded === undefined ? undefined : new Uint8Array(loaded.jobResource.bytes);
      },
    },
    { readFiles: 'when-shaped' },
  );
  return pageShaping;
}

/**
 * Lays text out on the page with a font library, exactly as the engine's `layout` job does
 * (`layoutTextNow` over `createLayoutJobRequest`), so the text tool's caret and the engine's
 * glyphs agree: shaped with HarfBuzz from the library's files when given the shaper, as the
 * engine's jobs are. Answers `undefined` while the library has no face.
 *
 * @param fonts - The library.
 * @param shaper - The loaded shaper; without it, per-codepoint metrics.
 * @returns The layout service.
 */
export function createFontLayoutService(fonts: FontLibrary, shaper?: Shaper): TextLayoutService {
  const shaping = shaper === undefined ? undefined : libraryShaping(fonts, shaper);
  return {
    layout: ({ text, runs, wrapWidth, align, paragraphs }) => {
      if (fonts.faces.length === 0) return undefined;
      const input = {
        objectId: 'page',
        text,
        runs,
        maxWidth: wrapWidth,
        align,
        ...(paragraphs === undefined ? {} : { paragraphs }),
      };
      return layoutTextNow(createLayoutJobRequest(input, fonts), shaping);
    },
  };
}

/** What the page's text layout lays out. */
type PageLayoutInput = Parameters<TextLayoutService['layout']>[0];

/**
 * The coverage needs of the texts the page lays out, kept by chunk: a keystroke lays a draft out
 * more than once, and reading a long draft's every character each time cost typing 3 ms of input
 * latency.
 */
const pageCoverage = new CoverageNeedsCache();

/**
 * The page's last layout, answered again while the same input asks with the same fonts: a
 * keystroke lays the edited text out twice, for its size and for its caret, and shaping a long
 * text costs milliseconds on the main thread.
 */
let lastPageLayout:
  | {
      readonly input: PageLayoutInput;
      readonly fonts: FontLibrary;
      readonly revision: number;
      readonly layout: TextLayout;
    }
  | undefined;

/**
 * Whether two layout inputs lay out the same: the same text, width and alignment, runs of the
 * same lengths and styles, and the same paragraph styles. The caret's runs are read back from the document after the size's
 * write, so they are equal but not the same array.
 *
 * @param left - One input.
 * @param right - The other.
 * @returns Whether they are the same.
 */
function isSameLayoutInput(left: PageLayoutInput, right: PageLayoutInput): boolean {
  return (
    left.text === right.text &&
    left.wrapWidth === right.wrapWidth &&
    left.align === right.align &&
    (left.runs === right.runs || JSON.stringify(left.runs) === JSON.stringify(right.runs)) &&
    (left.paragraphs === right.paragraphs ||
      JSON.stringify(left.paragraphs) === JSON.stringify(right.paragraphs))
  );
}

/**
 * The text tool's layout on the page: the page's fonts once something has started loading them
 * (`loadPageFonts`, which starting the browser's engine host does), nothing before, so a page
 * that never starts an engine never fetches a font. `whenReady` settles once they have loaded,
 * without starting the load.
 */
export const PAGE_TEXT_LAYOUT: TextLayoutService = {
  layout: (input) => {
    // Until the shaper has loaded too, as until the fonts have: never per codepoint.
    if (pageFonts === undefined || pageShaper === undefined) return undefined;
    // A CJK family's slices the text's characters are in, never the whole family,
    // read again only where the draft changed: typing asks on every keystroke.
    const needs = pageCoverage.needs(input.text, input.runs);
    for (const need of needs) void ensurePageCoverage(need);
    // A run naming a CJK family is among the needs, by slice.
    const runFamilies = input.runs
      .map(({ style }) => style.fontFamily)
      .filter((family) => !isSlicedFamily(family));
    for (const family of runFamilies) void ensurePageFont(family);
    const isPending = (status: FontLoadStatus | undefined): boolean =>
      status === 'idle' || status === 'loading';
    if (
      needs.some(({ family, slices, weights }) =>
        isPending(
          slices === undefined
            ? demand?.status(family)
            : demand?.sliceStatus(family, slices, weights),
        ),
      ) ||
      runFamilies.some((family) => isPending(demand?.status(family)))
    )
      return undefined;
    const { fonts } = pageFonts;
    const last = lastPageLayout;
    if (
      last?.fonts === fonts &&
      last.revision === fonts.revision &&
      isSameLayoutInput(last.input, input)
    )
      return last.layout;
    const layout = createFontLayoutService(fonts, pageShaper).layout(input);
    lastPageLayout =
      layout === undefined ? undefined : { input, fonts, revision: fonts.revision, layout };
    return layout;
  },
  whenReady: () => pageFontsReady,
};

/**
 * Settles once the page's fonts and shaper have loaded, whenever an engine starts loading them;
 * starts nothing itself. The site's loading bar waits on it.
 *
 * @returns The promise.
 */
export function whenPageFontsReady(): Promise<void> {
  return pageFontsReady;
}

/**
 * Requests a coverage family a text needs: a CJK family's slices, any other family
 * whole, after the default face is ready.
 *
 * @param need - The family, and for a CJK family its slices (`coverageNeeds`).
 * @returns Whether they loaded.
 */
export async function ensurePageCoverage(need: CoverageNeed): Promise<boolean> {
  if (need.slices === undefined) return ensurePageFont(need.family);
  await pageFontsReady;
  return (await demand?.ensureSlices(need.family, need.slices, { weights: need.weights })) ?? false;
}

/**
 * Requests a family after the default face is ready, retaining a fallback during loading.
 *
 * @param family - Stored family name.
 * @param shouldRetry - Explicitly retries a failed request.
 * @returns Whether its available faces loaded.
 */
export async function ensurePageFont(family: string, shouldRetry = false): Promise<boolean> {
  await pageFontsReady;
  if (demand?.status(family) === 'missing') await loadRemoteFontCatalogue();
  if (demand?.status(family) === 'missing') await demand.ensure(fallbackFamily(family));
  return demand?.ensure(family, shouldRetry) ?? false;
}

/**
 * Follows page font changes, without initiating network requests.
 *
 * @param listener - Called when loading state or installed faces change.
 * @returns Unsubscribes.
 */
export function subscribePageFonts(listener: () => void): () => void {
  FONT_LISTENERS.add(listener);
  return () => {
    FONT_LISTENERS.delete(listener);
  };
}

/**
 * Reads the page loader for picker status and catalogue registration.
 *
 * @returns The shared on-demand loader.
 * @throws {Error} When the page loader fails to initialise.
 */
export function pageFontLoader(): DemandFonts {
  loadPageFonts();
  if (demand === undefined) throw new Error('Font loader did not initialise.');
  return demand;
}

let remoteCatalogue: Promise<readonly FontFamilyEntry[]> | undefined;
let remoteCatalogueBase: string | undefined;

/**
 * Loads catalogue metadata once, without loading its font files.
 *
 * @param shouldRetry - Retries a previously unavailable catalogue.
 * @returns The available families, or none while the service is unavailable or the page has
 *   none (no request is made then).
 */
export function loadRemoteFontCatalogue(shouldRetry = false): Promise<readonly FontFamilyEntry[]> {
  const base = fontCatalogueBase();
  if (base === undefined) return Promise.resolve([]);
  if (shouldRetry || remoteCatalogueBase !== base) remoteCatalogue = undefined;
  remoteCatalogueBase = base;
  remoteCatalogue ??= fetchFontCatalogue(base)
    .then((entries) => {
      pageFontLoader().register(entries);
      return entries;
    })
    .catch(() => []);
  return remoteCatalogue;
}

/**
 * Reads installed face changes without starting an engine or any network request.
 *
 * @returns Current font revision, or zero before the engine starts.
 */
export function pageFontRevision(): number {
  return pageFonts?.fonts.revision ?? 0;
}

/**
 * A family's installed named faces on this page (`DemandFonts.namedFaces`), without
 * starting a renderer or fetching font files; `subscribePageFonts` tells when they change.
 *
 * @param family - Stored family name.
 * @returns Their PostScript names; none before the engine starts.
 */
export function pageNamedFaces(family: string): readonly string[] {
  return demand?.namedFaces(family) ?? [];
}

/**
 * Reads loading state without starting a renderer or fetching font files.
 *
 * @param family - Stored family name.
 * @returns Current state; idle before the engine starts.
 */
export function pageFontStatus(family: string): FontLoadStatus {
  return demand?.status(family) ?? 'idle';
}

/**
 * How the page's override size follower measures: shaped with the page's text
 * shaping, loading a family a measurement needs, and measuring again once a face has landed.
 */
export const PAGE_OVERRIDE_SHAPING: Pick<
  OverrideSizeFollowerOptions,
  'textShaping' | 'onMissingFace' | 'onFontsChanged'
> = {
  textShaping: pageTextShaping,
  onMissingFace: (face) => void ensurePageFont(face.family),
  // Only when a face landed, not on every change of loading status.
  onFontsChanged: (listener) => {
    let revision = pageFontRevision();
    return subscribePageFonts(() => {
      const next = pageFontRevision();
      if (next === revision) return;
      revision = next;
      listener();
    });
  },
};
