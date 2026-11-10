import { describe, expect, it } from 'vitest';

import {
  BUNDLE_EXPECTATIONS,
  findBundleProblems,
  type BundleVariant,
  type EmittedAsset,
  type LibraryBuild,
} from './bundle-expectations.ts';

/** The layout handler's string, which every production file carries. */
const LAYOUT_HANDLER = 'Layout needs the metrics';

/** The msdf handler's string, which only the job worker carries. */
const MSDF_HANDLER = 'msdfgen cannot read';

/** A font file's text: TrueType's tables by tag, among its bytes. */
const FONT_FILE = '\u0000\u0001cmap glyf';

/** Lora's bold italic source, as the library's catalogue names it. */
const LORA_BOLD_ITALIC = 'assets/fonts/library/lora/700i.ttf';

/** Another family's bold italic: the same basename, another source. */
const MERRIWEATHER_BOLD_ITALIC = 'assets/fonts/library/merriweather/700i.ttf';

/**
 * An asset emitted unchanged from one source file.
 *
 * @param source - The source path.
 * @returns Its provenance.
 */
function from(source: string): EmittedAsset {
  return { sources: [source], isSourceBytes: true };
}

/**
 * A build with an entry chunk and emitted files.
 *
 * @param entry - The entry chunk's code.
 * @param files - Other emitted files by name.
 * @param assets - The provenance of emitted assets by name; none by default.
 * @returns The build.
 */
function libraryBuild(
  entry: string,
  files: Record<string, string> = {},
  assets: Record<string, EmittedAsset> = {},
): LibraryBuild {
  return {
    entry,
    files: new Map(Object.entries(files)),
    assets: new Map(Object.entries(assets)),
  };
}

/**
 * Builds that meet every expectation, as the real bundle does.
 *
 * @returns The builds by variant.
 */
function passingBuilds(): Record<BundleVariant, LibraryBuild> {
  return {
    production: libraryBuild(
      `Keyboard shortcuts; ${LAYOUT_HANDLER}`,
      {
        'assets/engine-worker-abc.js': `mesh; ${LAYOUT_HANDLER}`,
        'assets/job-worker-def.js': `${LAYOUT_HANDLER}; ${MSDF_HANDLER}`,
        'assets/LiberationSans-Regular-cbskN6YR.ttf': FONT_FILE,
        // Two families' bold italics share a basename; only their sources tell them apart.
        'assets/700i-Zz9yXw12.ttf': FONT_FILE,
        'assets/700i-Lxr4jBCI.ttf': FONT_FILE,
        'assets/Geist-Regular-Ab3dEf9h.woff2': WOFF2_FILE,
        'assets/Geist-Medium-Ab3dEf9h.woff2': WOFF2_FILE,
        'assets/GeistMono-Regular-Ab3dEf9h.woff2': WOFF2_FILE,
        'assets/GeistMono-Medium-Ab3dEf9h.woff2': WOFF2_FILE,
      },
      {
        'assets/700i-Zz9yXw12.ttf': from(MERRIWEATHER_BOLD_ITALIC),
        'assets/700i-Lxr4jBCI.ttf': from(LORA_BOLD_ITALIC),
      },
    ),
    harness: libraryBuild('Keyboard shortcuts data-canvas-harness'),
  };
}

/**
 * The passing production build with Lora's bold italic emitted differently, or not at all.
 *
 * @param lora - The emitted name and provenance replacing the passing one; none removes it.
 * @param entry - The entry chunk's code; the passing one by default.
 * @returns The builds.
 */
function withLora(
  lora: { readonly name: string; readonly asset: EmittedAsset } | undefined,
  entry?: string,
): Record<BundleVariant, LibraryBuild> {
  const builds = passingBuilds();
  const files = Object.fromEntries(builds.production.files);
  const assets = Object.fromEntries(builds.production.assets);
  delete files['assets/700i-Lxr4jBCI.ttf'];
  delete assets['assets/700i-Lxr4jBCI.ttf'];
  if (lora !== undefined) {
    files[lora.name] = FONT_FILE;
    assets[lora.name] = lora.asset;
  }
  builds.production = libraryBuild(entry ?? builds.production.entry, files, assets);
  return builds;
}

/** A WOFF2 file's text: its signature, then compressed tables. */
const WOFF2_FILE = 'wOF2 compressed';

describe('findBundleProblems', () => {
  it('finds nothing when every expectation holds', () => {
    expect(findBundleProblems(passingBuilds())).toEqual([]);
  });

  it('names text that must be absent, and text missing from the file that must carry it', () => {
    const builds = passingBuilds();
    builds.production = libraryBuild(
      `Keyboard shortcuts engineHarness; ${LAYOUT_HANDLER}`,
      {
        ...Object.fromEntries(builds.production.files),
        'assets/engine-worker-abc.js': MSDF_HANDLER,
      },
      Object.fromEntries(builds.production.assets),
    );
    expect(findBundleProblems(builds)).toEqual([
      `the production build's file entry chunk contains "engineHarness".`,
      `the production build's /engine-worker-[^/]*\\.js$/ lacks "Layout needs the metrics".`,
      `the production build's /engine-worker-[^/]*\\.js$/ contains "msdfgen cannot read".`,
    ]);
  });

  it('names a font inlined into the entry as data', () => {
    const builds = passingBuilds();
    builds.production = libraryBuild(
      `Keyboard shortcuts; ${LAYOUT_HANDLER}; new URL("data:font/ttf;base64,AAEAAA")`,
      Object.fromEntries(builds.production.files),
      Object.fromEntries(builds.production.assets),
    );
    expect(findBundleProblems(builds)).toEqual([
      `the production build's entry chunk contains "data:font".`,
    ]);
  });

  it('names a harness marker or the echo handler in any chunk, a lazy one or a worker included', () => {
    const builds = passingBuilds();
    builds.production = libraryBuild(
      builds.production.entry,
      {
        ...Object.fromEntries(builds.production.files),
        'assets/harness-panel-123.js': 'export const x = "data-canvas-harness";',
        'assets/job-worker-def.js': `${LAYOUT_HANDLER}; ${MSDF_HANDLER}; const e = (n) => ({ response: { message: n.message } });`,
      },
      Object.fromEntries(builds.production.assets),
    );
    expect(findBundleProblems(builds)).toEqual([
      `the production build's file assets/harness-panel-123.js contains "data-canvas-harness".`,
      `the production build's file assets/job-worker-def.js contains "response: { message:".`,
    ]);
  });

  it('names a font file emitted without a content hash', () => {
    const builds = passingBuilds();
    const files = new Map(builds.production.files);
    files.delete('assets/LiberationSans-Regular-cbskN6YR.ttf');
    files.set('LiberationSans-Regular.ttf', FONT_FILE);
    builds.production = { ...builds.production, files };
    expect(findBundleProblems(builds)).toEqual([
      "the production build's /^assets\\/LiberationSans-Regular-[A-Za-z0-9_-]{8}\\.ttf$/u: no emitted file matches.",
    ]);
  });

  it('names text that must be present and is not', () => {
    const builds = passingBuilds();
    builds.harness = libraryBuild('Keyboard shortcuts');
    expect(findBundleProblems(builds)).toEqual([
      `the harness build's entry chunk lacks "data-canvas-harness".`,
    ]);
  });

  it('reports a file no emitted name matches, once per expectation reading it', () => {
    const builds = passingBuilds();
    const files = new Map(builds.production.files);
    files.delete('assets/engine-worker-abc.js');
    builds.production = { ...builds.production, files };
    expect(findBundleProblems(builds)).toEqual([
      `the production build's /engine-worker-[^/]*\\.js$/: no emitted file matches.`,
      `the production build's /engine-worker-[^/]*\\.js$/: no emitted file matches.`,
    ]);
  });

  it('checks only the expectations it is given', () => {
    expect(
      findBundleProblems(passingBuilds(), [
        { variant: 'harness', file: 'entry', text: 'absent', isPresent: true },
      ]),
    ).toEqual([`the harness build's entry chunk lacks "absent".`]);
  });

  it('fails every row that needs text or a named file when the builds are empty', () => {
    const empty = { production: libraryBuild(''), harness: libraryBuild('') };
    const problems = findBundleProblems(empty);
    const presentOrNamed = BUNDLE_EXPECTATIONS.filter(
      ({ file, isPresent }) => isPresent || (file !== 'entry' && file !== 'every'),
    );
    expect(problems).toHaveLength(presentOrNamed.length);
  });
});

describe('the chrome font rows', () => {
  it('fail when a chrome face is emitted without a content hash', () => {
    const builds = passingBuilds();
    const files = new Map(builds.production.files);
    files.delete('assets/GeistMono-Medium-Ab3dEf9h.woff2');
    files.set('assets/GeistMono-Medium.woff2', WOFF2_FILE);
    builds.production = libraryBuild(
      builds.production.entry,
      Object.fromEntries(files),
      Object.fromEntries(builds.production.assets),
    );
    expect(findBundleProblems(builds)).toHaveLength(1);
  });

  it('fail when a WOFF2 face is inlined into the entry', () => {
    const builds = passingBuilds();
    builds.production = libraryBuild(
      `${builds.production.entry} url(data:font/woff2;base64,d09GMg)`,
      Object.fromEntries(builds.production.files),
      Object.fromEntries(builds.production.assets),
    );
    expect(findBundleProblems(builds)).toHaveLength(2);
  });
});

describe('the curated library face row', () => {
  const where = `the production build's file from ${LORA_BOLD_ITALIC}`;

  it('is satisfied by the file that comes from Lora’s own source, not by another family’s 700i', () => {
    expect(findBundleProblems(passingBuilds())).toEqual([]);
    // Without the decoy the row still holds; the decoy alone cannot satisfy it (below).
    const builds = passingBuilds();
    const files = new Map(builds.production.files);
    const assets = new Map(builds.production.assets);
    files.delete('assets/700i-Zz9yXw12.ttf');
    assets.delete('assets/700i-Zz9yXw12.ttf');
    builds.production = { ...builds.production, files, assets };
    expect(findBundleProblems(builds)).toEqual([]);
  });

  it('fails when only another family’s bold italic is emitted (wrong family)', () => {
    expect(findBundleProblems(withLora(undefined))).toEqual([
      `${where}: no emitted file comes from ${LORA_BOLD_ITALIC}.`,
    ]);
  });

  it('fails when the face is emitted under an unhashed name', () => {
    expect(
      findBundleProblems(withLora({ name: 'assets/700i.ttf', asset: from(LORA_BOLD_ITALIC) })),
    ).toEqual([`${where} is emitted as assets/700i.ttf, without a content hash.`]);
  });

  it('fails when the emitted bytes are not the source’s', () => {
    expect(
      findBundleProblems(
        withLora({
          name: 'assets/700i-Lxr4jBCI.ttf',
          asset: { sources: [LORA_BOLD_ITALIC], isSourceBytes: false },
        }),
      ),
    ).toEqual([
      `${where} is emitted as assets/700i-Lxr4jBCI.ttf with bytes that differ from ${LORA_BOLD_ITALIC}.`,
    ]);
  });

  it('fails when the face is inlined into the entry instead of emitted', () => {
    const builds = withLora(
      undefined,
      `Keyboard shortcuts; ${LAYOUT_HANDLER}; new URL("data:font/ttf;base64,AAEAAA")`,
    );
    expect(findBundleProblems(builds)).toEqual([
      `the production build's entry chunk contains "data:font".`,
      `${where}: no emitted file comes from ${LORA_BOLD_ITALIC}.`,
    ]);
  });

  it('fails when the emitted file is not a TrueType file, or comes from the source twice', () => {
    const notFont = withLora({ name: 'assets/700i-Lxr4jBCI.ttf', asset: from(LORA_BOLD_ITALIC) });
    const files = new Map(notFont.production.files);
    files.set('assets/700i-Lxr4jBCI.ttf', 'wOF2 compressed');
    notFont.production = { ...notFont.production, files };
    expect(findBundleProblems(notFont)).toEqual([
      `${where} (assets/700i-Lxr4jBCI.ttf) lacks "cmap".`,
    ]);
    const twice = passingBuilds();
    const assets = new Map(twice.production.assets);
    assets.set('assets/700i-Zz9yXw12.ttf', from(LORA_BOLD_ITALIC));
    twice.production = { ...twice.production, assets };
    expect(findBundleProblems(twice)).toEqual([
      `${where}: 2 emitted files come from ${LORA_BOLD_ITALIC}: assets/700i-Zz9yXw12.ttf, assets/700i-Lxr4jBCI.ttf.`,
    ]);
  });
});
