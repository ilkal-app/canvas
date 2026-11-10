// The SDK's bundle budget (measure first, then lock). What a host page
// downloads at once, the main script (the entry and the chunks it imports statically), gzipped,
// and the parts it loads only when needed, each counted apart: the engine and job workers, the
// other lazy chunks, the wasm, the fonts and the stylesheet. The fonts are the files of the fonts
// package, @ilkal/fonts: the build emits them into dist/fonts/, which the SDK's own
// package leaves out, and a font anywhere else in dist/ is a problem. Each part may not grow past
// its locked figure (bundle-budget.json). The heavy parts must stay files of their own, loaded when needed:
// the main script holding one inlined (a data URL of a font, the wasm or a script, or a long
// base64 run, as library mode does unless told otherwise), a heavy part with no files
// left, or an emitted file no part counts, is a problem too. Pure: check-bundle-budget.ts builds
// the bundle and hands its files here.
import { gzipSync } from 'node:zlib';

/** One file the build emits. */
export interface BundleFile {
  /** Its name in dist/, e.g. `index.js` or `assets/engine-worker-x.js`. */
  readonly fileName: string;
  /** Its bytes, or its text. */
  readonly contents: Uint8Array | string;
  /** Whether it is the bundle's entry. */
  readonly isEntry: boolean;
  /** The chunks it imports statically, by file name; none for an asset. */
  readonly imports: readonly string[];
}

/** One part of the bundle: how many files, and their bytes raw and gzipped. */
export interface BundlePart {
  /** Files in the part. */
  readonly files: number;
  /** Their bytes as emitted. */
  readonly bytes: number;
  /**
   * Their bytes gzipped (level 9), each file alone, summed; content hashes in a script's file
   * references count as a fixed placeholder, so two builds of one tree measure the same.
   */
  readonly gzipBytes: number;
}

/** The parts the budget counts apart from the main script. */
export const LAZY_PARTS = ['workers', 'lazyChunks', 'wasm', 'fonts', 'stylesheet'] as const;

/** One of the {@link LAZY_PARTS}. */
export type LazyPart = (typeof LAZY_PARTS)[number];

/** A build measured: the main script, and each lazy part. */
export interface BundleMeasure {
  /** The entry and every chunk it imports statically, transitively: loaded at once. */
  readonly main: BundlePart;
  /** Each part loaded only when needed. */
  readonly lazy: Readonly<Record<LazyPart, BundlePart>>;
  /**
   * What the main script holds inlined that should be a file of its own: a data URL of a font,
   * the wasm or a script (by type, with how many), or a base64 run of 64 kB or more. None, or a
   * problem.
   */
  readonly inlined: readonly string[];
  /** Emitted files no part counts (not a map or a declaration): none, or a problem. */
  readonly unbudgeted: readonly string[];
  /**
   * Font files emitted outside dist/fonts/, so in the SDK's own package rather than the fonts
   * package's: none, or a problem.
   */
  readonly strayFonts: readonly string[];
}

/**
 * A content hash in a file reference (`./index-Dz6U3U56.js`): the one thing that differs between
 * two builds of one tree (a chunk's hash follows its workers' and assets', which vary), so it is
 * replaced by a placeholder of the same length before measuring, and the figures are exact.
 */
const HASHED_NAME =
  /-[A-Za-z0-9_-]{8}(?=(?:-[A-Za-z0-9_-]{8})*\.(?:js|css|wasm|ttf|otf|woff2?)\b)/gu;

/** What {@link HASHED_NAME} is replaced by: the same length, so raw sizes are unchanged. */
const HASH_PLACEHOLDER = '-00000000';

/** The parts that must stay files of their own, loaded when needed: never empty. */
const HEAVY_PARTS: readonly LazyPart[] = ['workers', 'wasm', 'fonts'];

/** A data URL of a font, a wasm module or a script: an asset inlined into the script. */
const HEAVY_DATA_URL =
  /data:((?:font\/|application\/(?:x-)?font)[\w.+-]*|application\/wasm|(?:text|application)\/javascript)[;,]/gu;

/** The length of a base64 run that is an asset inlined as a string (an inline worker's `encodedJs`). */
const LONG_BASE64_LENGTH = 65_536;

/**
 * Whether a character code is a base64 digit (`A–Z`, `a–z`, `0–9`, `+`, `/`).
 *
 * @param code - The character code.
 * @returns True for one.
 */
function isBase64Digit(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 43 ||
    code === 47
  );
}

/**
 * The lengths of a text's base64 runs of {@link LONG_BASE64_LENGTH} or more, in one pass.
 *
 * @param text - The text.
 * @returns The runs' lengths, in order.
 */
function longBase64Runs(text: string): number[] {
  const runs: number[] = [];
  let run = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index < text.length && isBase64Digit(text.charCodeAt(index))) {
      run += 1;
      continue;
    }
    if (run >= LONG_BASE64_LENGTH) runs.push(run);
    run = 0;
  }
  return runs;
}

/** Emitted files nothing loads: source maps, declarations and the fonts' licence files. */
const NOT_LOADED = /\.(?:map|d\.ts)$|^fonts\/(?:.*\/)?(?:LICEN[CS]E|OFL|COPYING)[^/]*$/u;

/** A font file. */
const FONT_FILE = /\.(?:ttf|otf|woff2?)$/u;

/** The folder of dist/ the fonts package's files are emitted into. */
const FONTS_DIR = 'fonts/';

/**
 * What a main-script file holds inlined: each data URL type with its count, and each long base64
 * run with its length.
 *
 * @param file - The file.
 * @returns The findings.
 */
function inlinedIn(file: BundleFile): string[] {
  const text =
    typeof file.contents === 'string'
      ? file.contents
      : Buffer.from(file.contents).toString('latin1');
  const types = new Map<string, number>();
  for (const [, type = ''] of text.matchAll(HEAVY_DATA_URL))
    types.set(type, (types.get(type) ?? 0) + 1);
  return [
    ...[...types].map(([type, count]) => `${file.fileName}: ${String(count)} data:${type} URL(s)`),
    ...longBase64Runs(text).map(
      (length) => `${file.fileName}: a base64 run of ${String(length)} characters`,
    ),
  ];
}

/** The locked figures: each part's gzipped bytes may not exceed its own. */
export interface BundleBudget {
  /** The main script's gzipped bytes. */
  readonly mainGzipBytes: number;
  /** Each lazy part's gzipped bytes. */
  readonly lazyGzipBytes: Readonly<Record<LazyPart, number>>;
}

/**
 * The lazy part a file outside the main script belongs to; `undefined` for one no part counts
 * (a source map or a declaration, which nothing loads, or an unknown kind of asset).
 *
 * @param fileName - The file's name in dist/.
 * @returns The part.
 */
export function lazyPartOf(fileName: string): LazyPart | undefined {
  if (NOT_LOADED.test(fileName)) return undefined;
  if (FONT_FILE.test(fileName)) return 'fonts';
  if (fileName.endsWith('.wasm')) return 'wasm';
  if (fileName.endsWith('.css')) return 'stylesheet';
  if (!fileName.endsWith('.js')) return undefined;
  return fileName.includes('worker') ? 'workers' : 'lazyChunks';
}

/**
 * A part's figures from its files.
 *
 * @param files - The files.
 * @returns The part.
 */
function partOf(files: readonly BundleFile[]): BundlePart {
  let bytes = 0;
  let gzipBytes = 0;
  for (const { contents } of files) {
    const raw =
      typeof contents === 'string'
        ? Buffer.from(contents.replaceAll(HASHED_NAME, HASH_PLACEHOLDER))
        : contents;
    bytes += raw.byteLength;
    gzipBytes += gzipSync(raw, { level: 9 }).byteLength;
  }
  return { files: files.length, bytes, gzipBytes };
}

/**
 * Measures a build: the main script is the entry and the chunks it reaches by static imports
 * (an external such as React is not a file and is skipped); every other file is counted in its
 * lazy part. The stylesheet the entry imports by name loads at once, but is counted apart. Pure.
 *
 * @param files - The build's files.
 * @returns The measure.
 * @throws {Error} When the build has no entry.
 */
export function measureBundle(files: readonly BundleFile[]): BundleMeasure {
  const byName = new Map(files.map((file) => [file.fileName, file]));
  const entry = files.find(({ isEntry }) => isEntry);
  if (entry === undefined) throw new Error('The build has no entry.');
  const main = new Set<string>();
  const reach = (fileName: string): void => {
    const file = byName.get(fileName);
    if (file === undefined || main.has(fileName)) return;
    main.add(fileName);
    for (const imported of file.imports) reach(imported);
  };
  reach(entry.fileName);
  const lazy = Object.fromEntries(LAZY_PARTS.map((part) => [part, [] as BundleFile[]])) as Record<
    LazyPart,
    BundleFile[]
  >;
  const unbudgeted: string[] = [];
  for (const file of files) {
    if (main.has(file.fileName)) continue;
    const part = lazyPartOf(file.fileName);
    if (part !== undefined) lazy[part].push(file);
    else if (!NOT_LOADED.test(file.fileName)) unbudgeted.push(file.fileName);
  }
  const mainFiles = [...main].flatMap((name) => byName.get(name) ?? []);
  const strayFonts = files
    .map(({ fileName }) => fileName)
    .filter((fileName) => FONT_FILE.test(fileName) && !fileName.startsWith(FONTS_DIR));
  return {
    main: partOf(mainFiles),
    lazy: Object.fromEntries(LAZY_PARTS.map((part) => [part, partOf(lazy[part])])) as Record<
      LazyPart,
      BundlePart
    >,
    inlined: mainFiles.flatMap((file) => inlinedIn(file)),
    unbudgeted,
    strayFonts,
  };
}

/**
 * The budget a measure would lock: its own gzipped figures (`--update`, with the owner's yes).
 *
 * @param measure - The measure.
 * @returns The budget.
 */
export function budgetOf(measure: BundleMeasure): BundleBudget {
  return {
    mainGzipBytes: measure.main.gzipBytes,
    lazyGzipBytes: Object.fromEntries(
      LAZY_PARTS.map((part) => [part, measure.lazy[part].gzipBytes]),
    ) as Record<LazyPart, number>,
  };
}

/**
 * The most a part may weigh, gzipped: its locked figure plus 1% for growth, rounded down (owner,
 * 2026-11-07). More than that needs the owner's yes and a new figure. Pure.
 *
 * @param locked - The part's locked figure, bytes gzipped.
 * @returns The bytes it may reach.
 */
export function allowedBytes(locked: number): number {
  return locked + Math.floor(locked / 100);
}

/**
 * What a measure breaks: each part grown more than 1% past its locked figure ({@link allowedBytes}); anything the main script holds
 * inlined; a heavy part (workers, wasm, fonts) with no files of its own; an emitted file no part
 * counts; a font outside dist/fonts/, which would ship in the SDK's own package. Pure.
 *
 * @param measure - The build measured.
 * @param budget - The locked figures.
 * @returns The problem lines; none when the build is within its budget.
 */
export function budgetProblems(measure: BundleMeasure, budget: BundleBudget): string[] {
  const over = (name: string, gzipBytes: number, locked: number): string[] =>
    gzipBytes > allowedBytes(locked)
      ? [
          `${name}: ${String(gzipBytes)} bytes gzipped, over its budget of ${String(locked)} plus 1% (+${String(gzipBytes - locked)})`,
        ]
      : [];
  return [
    ...over('main script', measure.main.gzipBytes, budget.mainGzipBytes),
    ...LAZY_PARTS.flatMap((part) =>
      over(part, measure.lazy[part].gzipBytes, budget.lazyGzipBytes[part]),
    ),
    ...measure.inlined.map((finding) => `inlined into the main script, not lazy: ${finding}`),
    ...HEAVY_PARTS.filter((part) => measure.lazy[part].files === 0).map(
      (part) => `${part}: no files of their own (inlined into the main script, or gone)`,
    ),
    ...measure.unbudgeted.map((name) => `counted by no part of the budget: ${name}`),
    ...measure.strayFonts.map(
      (name) => `a font in the SDK's own package, not in ${FONTS_DIR} (the fonts package): ${name}`,
    ),
  ];
}

/**
 * The measure as a report: each part's files and bytes, raw and gzipped, beside its budget.
 *
 * @param measure - The measure.
 * @param budget - The locked figures.
 * @returns The report's lines.
 */
export function budgetReport(measure: BundleMeasure, budget: BundleBudget): string[] {
  const kb = (bytes: number): string => `${(bytes / 1000).toFixed(1)} kB`;
  const line = (name: string, part: BundlePart, limit: number): string =>
    `  ${name.padEnd(12)} ${String(part.files).padStart(5)} files  ${kb(part.bytes).padStart(12)}  ${kb(part.gzipBytes).padStart(12)} gzipped  (budget ${kb(limit)})`;
  return [
    line('main script', measure.main, budget.mainGzipBytes),
    ...LAZY_PARTS.map((part) => line(part, measure.lazy[part], budget.lazyGzipBytes[part])),
  ];
}
