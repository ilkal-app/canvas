import { fontFileUrl } from '../text-input/font-file-urls.js';

/** One face of the chrome's fonts: its family, weight and file. */
export interface ChromeFontFace {
  /** The family `--font-ui` or `--font-mono` asks for (`Geist`, `Geist Mono`). */
  readonly family: string;
  /** The face's weight. */
  readonly weight: 400 | 500;
  /** The file's URL. */
  readonly url: string;
  /** The face's descriptors beyond its weight (its display policy, metric overrides). */
  readonly descriptors?: FontFaceDescriptors;
  /**
   * Whether it is fetched as soon as the theme mounts, as a preload would, since nearly every
   * label needs it; otherwise when text first needs it. False if absent.
   */
  readonly isEager?: boolean;
}

/**
 * A metric-matched stand-in for the UI font while it loads: local faces sized and boxed like it,
 * so the chrome barely reflows when it lands.
 */
export interface ChromeFallbackFace {
  /** The stand-in's family, named after the UI font in `--font-ui`. */
  readonly family: string;
  /** Its `src` descriptor: `local(…)` faces. */
  readonly source: string;
  /** Its descriptors: the weights it stands in for, its size and metric overrides. */
  readonly descriptors: FontFaceDescriptors;
}

/**
 * The fonts the chrome is set in: the faces to add to the page, the families its text
 * styles ask for, and an optional stand-in. The shell's own is {@link NEUTRAL_CHROME_FONTS}; a
 * host gives its own through `AppShellProps.chromeFonts` (the site, its brand's).
 */
export interface ChromeFontSet {
  /** The faces, added to the page once. */
  readonly faces: readonly ChromeFontFace[];
  /** `--font-ui`: the UI font, then the system's for scripts it lacks. */
  readonly ui: string;
  /** `--font-mono`: numbers and shortcut keys. */
  readonly mono: string;
  /** The UI font's stand-in while it loads; none if absent. */
  readonly fallback?: ChromeFallbackFace;
}

// As the text fonts' (font-catalogue.ts): written inline so Vite emits the files, `?no-inline`
// so a library build keeps them as content-hashed files beside the bundle, never base64.

/**
 * Geist Mono at 400 and 500, the chrome's numbers and shortcut keys, from the `geist`
 * npm package 1.7.2 under the SIL Open Font License 1.1.
 */
export const GEIST_MONO_FACES: readonly ChromeFontFace[] = [
  {
    family: 'Geist Mono',
    weight: 400,
    url: new URL('../../assets/fonts/GeistMono-Regular.woff2?no-inline', import.meta.url).href,
  },
  {
    family: 'Geist Mono',
    weight: 500,
    url: new URL('../../assets/fonts/GeistMono-Medium.woff2?no-inline', import.meta.url).href,
  },
];

/** `--font-mono`: Geist Mono, then the system's monospace font. */
export const GEIST_MONO_STACK = '"Geist Mono", ui-monospace, monospace';

/**
 * The shell's own fonts, open and neutral: Geist at 400 and 500 for the
 * chrome, from the `geist` npm package 1.7.2 under the SIL Open Font License 1.1, and Geist
 * Mono for its numbers and keys. Both are kept in `packages/app/assets/fonts/` (the package
 * README lists their hashes). Geist is fetched at once, with `font-display: fallback`; scripts
 * it lacks fall through to the system's font. Only the chrome uses them: text on the board is
 * set in the text fonts, which these never replace.
 */
export const NEUTRAL_CHROME_FONTS: ChromeFontSet = {
  faces: [
    {
      family: 'Geist',
      weight: 400,
      url: new URL('../../assets/fonts/Geist-Regular.woff2?no-inline', import.meta.url).href,
      descriptors: { display: 'fallback' },
      isEager: true,
    },
    {
      family: 'Geist',
      weight: 500,
      url: new URL('../../assets/fonts/Geist-Medium.woff2?no-inline', import.meta.url).href,
      descriptors: { display: 'fallback' },
      isEager: true,
    },
    ...GEIST_MONO_FACES,
  ],
  ui: '"Geist", system-ui, -apple-system, "Segoe UI", "Noto Sans", sans-serif',
  mono: GEIST_MONO_STACK,
};

/**
 * Makes one face: the page's `FontFace`, or a test's stand-in.
 *
 * @param family - The family name.
 * @param source - The `src` descriptor.
 * @param descriptors - The weight, as CSS writes it, and any other descriptors.
 * @returns The face.
 */
export type ChromeFontFaceFactory = (
  family: string,
  source: string,
  descriptors: FontFaceDescriptors,
) => FontFace;

/** The font sets each page's fonts were given, so each set is added once per page. */
const LOADED_SETS = new WeakMap<Pick<FontFaceSet, 'add'>, WeakSet<ChromeFontSet>>();

/**
 * The page's face factory, or undefined where the page has no `FontFace` (jsdom, a server).
 *
 * @returns The factory, or undefined.
 */
function pageFaceFactory(): ChromeFontFaceFactory | undefined {
  if (typeof FontFace === 'undefined') return undefined;
  return (family, source, descriptors) => new FontFace(family, source, descriptors);
}

/**
 * Adds a set of chrome fonts to the page, once per page however many shell or site roots ask,
 * and its stand-in. Its eager faces are fetched at once, as a preload would; the others when
 * text first needs them. A face that fails to load leaves its text in the fallback. Does nothing
 * where the page has no font loading.
 *
 * @param fonts - The set; the shell's own, {@link NEUTRAL_CHROME_FONTS}, if absent.
 * @param fontSet - Where to add them; the page's `document.fonts` if absent.
 * @param makeFace - Makes each face; the page's `FontFace` if absent.
 * @param loaded - The sets each page was already given; the module's own if absent.
 */
export function loadChromeFonts(
  fonts: ChromeFontSet = NEUTRAL_CHROME_FONTS,
  fontSet: Pick<FontFaceSet, 'add'> | undefined = typeof document === 'undefined'
    ? undefined
    : document.fonts,
  makeFace: ChromeFontFaceFactory | undefined = pageFaceFactory(),
  loaded: WeakMap<Pick<FontFaceSet, 'add'>, WeakSet<ChromeFontSet>> = LOADED_SETS,
): void {
  if (fontSet === undefined || makeFace === undefined) return;
  const given = loaded.get(fontSet) ?? new WeakSet<ChromeFontSet>();
  if (given.has(fonts)) return;
  given.add(fonts);
  loaded.set(fontSet, given);
  for (const face of fonts.faces) {
    const source = `url("${fontFileUrl(face.url)}") format("woff2")`;
    const added = makeFace(face.family, source, {
      ...face.descriptors,
      weight: String(face.weight),
    });
    fontSet.add(added);
    if (face.isEager === true) added.load().catch(() => undefined);
  }
  if (fonts.fallback !== undefined) {
    const { family, source, descriptors } = fonts.fallback;
    fontSet.add(makeFace(family, source, descriptors));
  }
}

/**
 * Sets the chrome's two font families on a themed element, after its theme: the set's
 * `--font-ui` and `--font-mono`, which the text styles read.
 *
 * @param element - The themed element (the shell's root, the site's frame).
 * @param fonts - The set.
 */
export function applyChromeFonts(element: HTMLElement, fonts: ChromeFontSet): void {
  element.style.setProperty('--font-ui', fonts.ui);
  element.style.setProperty('--font-mono', fonts.mono);
}
