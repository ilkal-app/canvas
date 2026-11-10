// The SDK's fonts live in a package of their own, @ilkal/fonts: the SDK's package
// carries none of them. The build names each font file the bundle asks for by its path in that
// package, under the scheme below, and emits the files into dist/fonts/, which the SDK's package
// leaves out and @ilkal/fonts copies (packages/fonts/scripts/build-fonts.ts). At run time the
// SDK resolves each name against its `fontsUrl`: jsDelivr's copy of @ilkal/fonts at the SDK's
// version, unless the host serves the files itself. vite.config.ts hands the scheme and that URL
// to the bundle (`CANVAS_SDK_FONTS`, src/mount/fonts-url.ts).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import MagicString from 'magic-string';
import type { Plugin } from 'vite';

/** The scheme a font file's name carries in the bundle, before the SDK resolves it. */
export const FONT_FILE_SCHEME = 'canvas-sdk-font:';

/** Where the build puts the font files in dist/: left out of the SDK's package. */
export const FONTS_DIR = 'fonts';

/** The CDN the fonts load from by default: jsDelivr's copy of an npm package. */
const JSDELIVR = 'https://cdn.jsdelivr.net/npm/';

/**
 * `new URL('<font file>', import.meta.url)` as a module writes it, over lines and with a
 * trailing comma, with or without a query (`?no-inline`): a TrueType, OpenType or WOFF file.
 */
const FONT_URL =
  /new URL\(\s*(["'])([^"'?#]+\.(?:ttf|otf|woff2?))(?:\?[^"'#]*)?\1\s*,\s*import\.meta\.url\s*,?\s*\)/gu;

/** A licence file kept beside the fonts it covers. */
const LICENCE_FILE = /^(?:LICEN[CS]E|OFL|COPYING)/iu;

/**
 * The URL a host's fonts load from by default: jsDelivr's copy of the fonts package at a version.
 *
 * @param fontsPackage - The fonts package's npm name.
 * @param version - The version, the SDK's own.
 * @returns The URL, ending in `/`.
 */
export function defaultFontsUrl(fontsPackage: string, version: string): string {
  return `${JSDELIVR}${fontsPackage}@${version}/`;
}

/**
 * A font file's path in the fonts package: a workspace package's `assets/fonts/<rest>` as
 * `<package folder>/<rest>`, an npm package's file as `npm/<package>/<rest>`. Pure.
 *
 * @param file - The file's absolute path.
 * @returns Its path in the fonts package, `/`-separated.
 * @throws {Error} For a file in neither place.
 */
export function fontFilePath(file: string): string {
  const parts = file.split(sep).join('/');
  // After the last node_modules/: pnpm keeps each package under .pnpm/<id>/node_modules/.
  const npm = /\/node_modules\/((?:@[^/]+\/)?[^/@.][^/]*\/(?:(?!node_modules\/).)+)$/u.exec(parts);
  if (npm !== null) return `npm/${npm[1] ?? ''}`;
  const workspace = /\/(?:packages|services|tooling)\/([^/]+)\/assets\/fonts\/(.+)$/u.exec(parts);
  if (workspace !== null) return `${workspace[1] ?? ''}/${workspace[2] ?? ''}`;
  throw new Error(`${file}: a font file outside a package's assets/fonts/ and node_modules/`);
}

/**
 * The licence files that cover a font: those in its own folder, or, for an npm package's font,
 * the nearest folder up to the package's root that has any.
 *
 * @param file - The font file's absolute path.
 * @returns The licence files' absolute paths; none when no folder has one.
 */
export function licenceFilesOf(file: string): string[] {
  let folder = dirname(file);
  const isNpm = file.split(sep).includes('node_modules');
  for (;;) {
    const licences = readdirSync(folder)
      .filter((name) => LICENCE_FILE.test(name))
      .map((name) => join(folder, name));
    if (licences.length > 0 || !isNpm || existsSync(join(folder, 'package.json'))) return licences;
    folder = dirname(folder);
  }
}

/** One font URL a module names, found by {@link fontUrlsIn}. */
export interface FontUrlMatch {
  /** Where the expression starts in the code. */
  readonly start: number;
  /** Where it ends. */
  readonly end: number;
  /** The file it names, relative to the module. */
  readonly relativePath: string;
}

/**
 * The font URLs a module's code names (`new URL('<font>', import.meta.url)`). Pure.
 *
 * @param code - The module's code.
 * @returns Each one, in order.
 */
export function fontUrlsIn(code: string): FontUrlMatch[] {
  return [...code.matchAll(FONT_URL)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    relativePath: match[2] ?? '',
  }));
}

/**
 * The font file names a built script holds (`canvas-sdk-font:<path>`), each once. Pure.
 *
 * @param code - The script.
 * @returns The paths in the fonts package, sorted.
 */
export function fontNamesIn(code: string): string[] {
  const scheme = FONT_FILE_SCHEME.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const names = new Set(
    [...code.matchAll(new RegExp(`${scheme}([^"'\`\\s]+)`, 'gu'))].map((match) => match[1] ?? ''),
  );
  return [...names].sort();
}

/**
 * The font names the build's scripts hold that it emits no file for: none, or a problem. Pure.
 *
 * @param scripts - Each emitted script's code (the entry's chunks and the workers').
 * @param emitted - The emitted files' names in dist/.
 * @returns The names with no file, sorted.
 */
export function missingFontFiles(
  scripts: readonly string[],
  emitted: ReadonlySet<string>,
): string[] {
  const names = new Set(scripts.flatMap((code) => fontNamesIn(code)));
  return [...names].filter((name) => !emitted.has(`${FONTS_DIR}/${name}`)).sort();
}

/**
 * Takes the fonts out of the bundle: each `new URL('<font>', import.meta.url)` becomes
 * `new URL('canvas-sdk-font:<path>')`, the file's path in the fonts package
 * ({@link fontFilePath}), and the build emits each file, with the licence files beside it, into
 * dist/fonts/ at that path. Two files at one path fail the build, as does a name in any emitted
 * script (a worker's too) with no file.
 *
 * @param options - What this bundle does with the files.
 * @param options.shouldEmit - Whether it emits them: the entry's bundle, not a worker's, so each
 *   is written once.
 * @returns The plugin.
 */
export function fontFilesOutside(options: { readonly shouldEmit: boolean }): Plugin {
  const files = new Map<string, string>();
  return {
    name: 'canvas-sdk:font-files-outside',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      const path = id.replace(/[?#].*$/u, '');
      if (!/\.[cm]?[jt]sx?$/u.test(path) || !code.includes('import.meta.url')) return undefined;
      const matches = fontUrlsIn(code);
      if (matches.length === 0) return undefined;
      const edited = new MagicString(code);
      for (const { start, end, relativePath } of matches) {
        const file = resolve(dirname(path), relativePath);
        if (!existsSync(file)) this.error(`${relative(process.cwd(), path)}: no font at ${file}`);
        const name = fontFilePath(file);
        const known = files.get(name);
        if (known !== undefined && known !== file)
          this.error(`Two font files would be ${name} in the fonts package: ${known} and ${file}`);
        files.set(name, file);
        edited.overwrite(start, end, `new URL(${JSON.stringify(FONT_FILE_SCHEME + name)})`);
      }
      return { code: edited.toString(), map: edited.generateMap({ hires: true, source: id }) };
    },
    generateBundle(outputOptions, bundle) {
      if (!options.shouldEmit) return;
      const emitted = new Set<string>();
      const emit = (fileName: string, source: string): void => {
        if (emitted.has(fileName)) return;
        emitted.add(fileName);
        this.emitFile({ type: 'asset', fileName, source: readFileSync(source) });
      };
      for (const [name, file] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
        emit(`${FONTS_DIR}/${name}`, file);
        const folder = dirname(name);
        for (const licence of licenceFilesOf(file))
          emit(`${FONTS_DIR}/${folder}/${licence.split(sep).at(-1) ?? ''}`, licence);
      }
      // The workers are bundled apart and arrive here as assets: their names count too.
      const scripts = Object.values(bundle).flatMap((output) => {
        if (output.type === 'chunk') return [output.code];
        return output.fileName.endsWith('.js') && typeof output.source === 'string'
          ? [output.source]
          : [];
      });
      const missing = missingFontFiles(scripts, emitted);
      if (missing.length > 0)
        this.error(`The bundle names fonts it emits no file for: ${missing.join(', ')}`);
    },
  };
}
