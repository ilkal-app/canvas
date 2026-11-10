// What the app's library bundle must and must not contain, checked by `pnpm --filter @canvas/app
// test:bundle` (check-bundle.ts) after `build`, so the unit tier (`pnpm test`) never runs Vite.

/** The two library builds the check makes: without and with `VITE_CANVAS_HARNESS=1`. */
export type BundleVariant = 'production' | 'harness';

/** Where an emitted asset came from, as the build records it. */
export interface EmittedAsset {
  /**
   * The source files it was emitted from, relative to the app's folder with `/` separators
   * (`assets/fonts/library/lora/700i.ttf`); empty for an asset the build generated itself.
   */
  readonly sources: readonly string[];
  /** Whether the emitted bytes are exactly the source file's (false for a transformed asset). */
  readonly isSourceBytes: boolean;
}

/** One library build, in memory. */
export interface LibraryBuild {
  /**
   * The code the page loads with the library: the entry chunk (`dist/index.js`) and the chunks
   * it imports statically; not the chunks only `import()` loads.
   */
  readonly entry: string;
  /** Every emitted file's text by name: chunks and assets, the worker scripts among them. */
  readonly files: ReadonlyMap<string, string>;
  /** Every emitted asset's provenance by name. */
  readonly assets: ReadonlyMap<string, EmittedAsset>;
}

/**
 * The one emitted file that comes from a source file of the package, named by the source
 * (library font files share their basenames across families, `lora/700i.ttf` and
 * `merriweather/700i.ttf`, so an emitted name alone cannot say which family a file is).
 */
export interface SourceFile {
  /** The source path, relative to the app's folder with `/` separators. */
  readonly source: string;
}

/** One assertion about a build's text: a row of {@link BUNDLE_EXPECTATIONS}. */
export interface BundleExpectation {
  /** The build it reads. */
  readonly variant: BundleVariant;
  /**
   * The file: `entry` for the entry chunk with its static imports (the startup code); `every`
   * for each emitted JavaScript file on its own (every chunk, lazy ones and worker scripts
   * included), for text that must not ship at all; a {@link SourceFile} for the one emitted
   * asset that comes from that source, which must be a separate file with a content-hashed name
   * and the source's exact bytes; else the one emitted file whose name matches.
   */
  readonly file: 'entry' | 'every' | SourceFile | RegExp;
  /** The text looked for. */
  readonly text: string;
  /** Whether the text must be there (`true`) or must not (`false`). */
  readonly isPresent: boolean;
}

const ENGINE_WORKER = /engine-worker-[^/]*\.js$/;
const JOB_WORKER = /job-worker-[^/]*\.js$/;

/**
 * A string only the `echo` test handler carries (its response, as the build prints it). The
 * app's job worker registers the shipped handlers only (`createProductionJobHandlers`), so it is
 * in no emitted file.
 */
const ECHO_HANDLER_STRING = 'response: { message:';

/** The harness's markers: only a build with `VITE_CANVAS_HARNESS=1` may carry them. */
const HARNESS_STRINGS = ['data-canvas-harness', 'canvasHarness', 'engineHarness'] as const;

/**
 * A font file's emitted name, with the content hash the build gives it (`assets/<name>-<hash>`).
 * An unhashed name matches no file, so the row fails.
 *
 * @param name - The file's name without the extension.
 * @param extension - The file's extension: `ttf` for the text fonts, `woff2` for the chrome's.
 * @returns The pattern.
 */
function hashedFont(name: string, extension: 'ttf' | 'woff2' = 'ttf'): RegExp {
  return new RegExp(`^assets/${name}-[A-Za-z0-9_-]{8}\\.${extension}$`, 'u');
}

/**
 * An emitted asset's name with the content hash the build gives it: `assets/<basename>-<hash>`.
 *
 * @param source - The source path.
 * @returns The pattern an emitted name must match to count as hashed.
 */
function hashedNameOf(source: string): RegExp {
  const basename = source.slice(source.lastIndexOf('/') + 1);
  const dot = basename.lastIndexOf('.');
  const stem = basename.slice(0, dot).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const extension = basename.slice(dot + 1);
  return new RegExp(`^assets/${stem}-[A-Za-z0-9_-]{8}\\.${extension}$`, 'u');
}

/** A curated library face the text tool loads on demand: Lora's bold italic. */
const LORA_BOLD_ITALIC: SourceFile = { source: 'assets/fonts/library/lora/700i.ttf' };

/** A table every TrueType file has, so a font file's text contains it. */
const TRUETYPE_TABLE = 'cmap';

/** The signature a WOFF2 file starts with. */
const WOFF2_SIGNATURE = 'wOF2';

/**
 * A string only the text layout handler carries (its error). The page lays text out itself for
 * the text tool's caret, and the engine's one pool (`EngineJobs`) falls back to the handler where
 * the engine renders, so it is in the page, the engine worker and the job worker.
 */
const LAYOUT_HANDLER_STRING = 'Layout needs the metrics';

/**
 * A string only the msdf handler carries (its error). The pool's fallback loads it as a chunk of
 * its own on the first glyph job without a job worker, so it is in neither the page nor the
 * engine worker; the job worker runs it.
 */
const MSDF_HANDLER_STRING = 'msdfgen cannot read';

/**
 * Every assertion about the library bundle, one per row: add a row to add a check.
 * The test harness and the echo test handler ship nowhere (harness markers only with
 * `VITE_CANVAS_HARNESS=1`); the layout handler is
 * bundled wherever text is laid out, the msdf handler only in the job worker (and its own chunk);
 * the font files are files beside the bundle, fetched by URL, never inlined.
 */
export const BUNDLE_EXPECTATIONS: readonly BundleExpectation[] = [
  { variant: 'production', file: 'entry', text: 'Keyboard shortcuts', isPresent: true },
  // The harness (the default mount attaches the engine harness only in harness builds) and the
  // echo test handler never ship: absent from every chunk, lazy ones and workers included, so
  // moving them into a chunk loaded later cannot pass.
  ...HARNESS_STRINGS.map((text): BundleExpectation => ({
    variant: 'production',
    file: 'every',
    text,
    isPresent: false,
  })),
  { variant: 'production', file: 'every', text: ECHO_HANDLER_STRING, isPresent: false },
  { variant: 'production', file: 'entry', text: LAYOUT_HANDLER_STRING, isPresent: true },
  { variant: 'production', file: ENGINE_WORKER, text: LAYOUT_HANDLER_STRING, isPresent: true },
  { variant: 'production', file: JOB_WORKER, text: LAYOUT_HANDLER_STRING, isPresent: true },
  { variant: 'production', file: 'entry', text: MSDF_HANDLER_STRING, isPresent: false },
  { variant: 'production', file: ENGINE_WORKER, text: MSDF_HANDLER_STRING, isPresent: false },
  { variant: 'production', file: JOB_WORKER, text: MSDF_HANDLER_STRING, isPresent: true },
  // The font faces are emitted as files and fetched by URL, never base64 inside.
  { variant: 'production', file: 'entry', text: 'data:font', isPresent: false },
  // Their names carry a content hash, as the chunks' do.
  {
    variant: 'production',
    file: hashedFont('LiberationSans-Regular'),
    text: TRUETYPE_TABLE,
    isPresent: true,
  },
  // A curated library face: the file that comes from Lora's own `700i.ttf`, emitted
  // separately with a content hash and the source's exact bytes. Other families ship a
  // `700i.ttf` too, so the row names the source, not an emitted name.
  { variant: 'production', file: LORA_BOLD_ITALIC, text: TRUETYPE_TABLE, isPresent: true },
  // The shell's own chrome faces, Geist and Geist Mono, likewise: files with
  // hashed names, none inlined.
  ...['Geist-Regular', 'Geist-Medium', 'GeistMono-Regular', 'GeistMono-Medium'].map(
    (name): BundleExpectation => ({
      variant: 'production',
      file: hashedFont(name, 'woff2'),
      text: WOFF2_SIGNATURE,
      isPresent: true,
    }),
  ),
  { variant: 'production', file: 'entry', text: 'data:font/woff2', isPresent: false },
  // The library is the open shell: the site's Rand, under the owner's licence, never
  // ships in it.
  { variant: 'production', file: 'entry', text: 'Rand-Regular', isPresent: false },
  { variant: 'production', file: 'entry', text: 'Rand-Medium', isPresent: false },
  { variant: 'harness', file: 'entry', text: 'data-canvas-harness', isPresent: true },
];

/**
 * The text of the file an expectation reads.
 *
 * @param build - The build.
 * @param file - `entry`, or the pattern of the one emitted file to read.
 * @returns Its text, or `undefined` when no emitted file matches.
 */
function fileText(build: LibraryBuild, file: 'entry' | RegExp): string | undefined {
  if (file === 'entry') return build.entry;
  return [...build.files].find(([name]) => file.test(name))?.[1];
}

/**
 * Checks an expectation that names a source file: exactly one emitted asset comes from it, as a
 * separate file with a content-hashed name and the source's exact bytes, and its text holds the
 * expectation.
 *
 * @param build - The build.
 * @param expectation - The row, its file a {@link SourceFile}.
 * @param where - How problems name the build.
 * @returns One line per problem; empty when the row holds.
 */
function sourceFileProblems(
  build: LibraryBuild,
  expectation: BundleExpectation & { readonly file: SourceFile },
  where: string,
): string[] {
  const { source } = expectation.file;
  const emitted = [...build.assets].filter(([, asset]) => asset.sources.includes(source));
  if (emitted.length === 0) return [`${where}: no emitted file comes from ${source}.`];
  if (emitted.length > 1) {
    const names = emitted.map(([name]) => name).join(', ');
    return [`${where}: ${String(emitted.length)} emitted files come from ${source}: ${names}.`];
  }
  const [[name, asset]] = emitted as [[string, EmittedAsset]];
  const problems: string[] = [];
  if (!hashedNameOf(source).test(name))
    problems.push(`${where} is emitted as ${name}, without a content hash.`);
  if (!asset.isSourceBytes)
    problems.push(`${where} is emitted as ${name} with bytes that differ from ${source}.`);
  const content = build.files.get(name) ?? '';
  const { text, isPresent } = expectation;
  if (content.includes(text) !== isPresent)
    problems.push(`${where} (${name}) ${isPresent ? 'lacks' : 'contains'} "${text}".`);
  return problems;
}

/**
 * Checks an expectation over every emitted JavaScript file on its own.
 *
 * @param build - The build.
 * @param expectation - The row, its file `every`.
 * @param where - How problems name the build.
 * @returns One line per file that breaks it (the entry chunk with its static imports first).
 */
function everyFileProblems(
  build: LibraryBuild,
  expectation: BundleExpectation,
  where: string,
): string[] {
  const { text, isPresent } = expectation;
  const scripts = [
    ['entry chunk', build.entry] as const,
    ...[...build.files].filter(([name]) => name.endsWith('.js')),
  ];
  return scripts
    .filter(([, content]) => content.includes(text) !== isPresent)
    .map(([name]) => `${where} ${name} ${isPresent ? 'lacks' : 'contains'} "${text}".`);
}

/**
 * Checks builds against expectations. Pure.
 *
 * @param builds - The builds by variant.
 * @param expectations - The assertions; {@link BUNDLE_EXPECTATIONS} by default.
 * @returns One line per failed assertion (a missing file counts), empty when all hold.
 */
export function findBundleProblems(
  builds: Readonly<Record<BundleVariant, LibraryBuild>>,
  expectations: readonly BundleExpectation[] = BUNDLE_EXPECTATIONS,
): string[] {
  return expectations.flatMap((expectation) => {
    const { variant, file, text, isPresent } = expectation;
    if (file === 'every') {
      return everyFileProblems(builds[variant], expectation, `the ${variant} build's file`);
    }
    // A RegExp has a `source` too (its pattern), so the source rows are told apart by type.
    if (file !== 'entry' && !(file instanceof RegExp)) {
      return sourceFileProblems(
        builds[variant],
        { ...expectation, file },
        `the ${variant} build's file from ${file.source}`,
      );
    }
    const where = `the ${variant} build's ${file === 'entry' ? 'entry chunk' : String(file)}`;
    const content = fileText(builds[variant], file);
    if (content === undefined) return [`${where}: no emitted file matches.`];
    if (content.includes(text) === isPresent) return [];
    return [`${where} ${isPresent ? 'lacks' : 'contains'} "${text}".`];
  });
}
