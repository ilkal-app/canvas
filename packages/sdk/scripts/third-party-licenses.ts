// Writes THIRD_PARTY_LICENSES.md: every npm package the open packages depend on at run time,
// with its licence and the full text of its licence file, read from node_modules so the list
// cannot drift from the lockfile. `--check` exits non-zero when the committed file is stale.
//
//   node --experimental-strip-types scripts/third-party-licenses.ts [--check]
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OPEN_PACKAGES } from './open-packages.ts';

/** One third-party npm package in the open packages' run-time closure. */
export interface ThirdPartyPackage {
  /** The npm name, e.g. `yjs`. */
  name: string;
  /** The installed version. */
  version: string;
  /** The package.json licence, as an SPDX expression. */
  license: string;
  /** The text of the package's licence file, line endings normalised. */
  licenseText: string;
}

interface Manifest {
  name: string;
  version: string;
  license?: string | { type: string };
  licenses?: { type: string }[];
  dependencies?: Record<string, string>;
}

/** The repository root, three levels above this file. */
const ROOT_DIR = fileURLToPath(new URL('../../..', import.meta.url));

/** Where the generated list lives, beside the SDK's NOTICE. */
export const THIRD_PARTY_FILE = fileURLToPath(
  new URL('../THIRD_PARTY_LICENSES.md', import.meta.url),
);

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest;
}

/**
 * Finds a dependency the way Node does: the nearest `node_modules/<name>` above `fromDir`.
 *
 * @param name - The dependency's npm name.
 * @param fromDir - The real directory of the package that depends on it.
 * @returns The dependency's real directory.
 * @throws {Error} When no `node_modules` above `fromDir` holds it.
 */
function resolveDependency(name: string, fromDir: string): string {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(dir) === dir) throw new Error(`${name} is not installed above ${fromDir}`);
  }
}

function licenseOf(manifest: Manifest): string {
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license !== undefined) return manifest.license.type;
  const legacy = manifest.licenses?.map(({ type }) => type) ?? [];
  if (legacy.length > 0) return legacy.join(' OR ');
  throw new Error(`${manifest.name}@${manifest.version} declares no licence`);
}

/**
 * What we record for a package that ships no licence file, keyed by `name@version`: checked by
 * hand from the package's own files, so a new version has to be checked again.
 */
const NO_LICENSE_FILE: Readonly<Record<string, string>> = {
  'brotli@1.3.3': [
    'brotli 1.3.3 (brotli.js) ships no licence file. Its package.json and its readme declare',
    'the MIT License, and its package.json names its author: Devon Govett',
    '<devongovett@gmail.com>. The MIT License:',
    '',
    '  Permission is hereby granted, free of charge, to any person obtaining a copy of this',
    '  software and associated documentation files (the "Software"), to deal in the Software',
    '  without restriction, including without limitation the rights to use, copy, modify, merge,',
    '  publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons',
    '  to whom the Software is furnished to do so, subject to the following conditions:',
    '',
    '  The above copyright notice and this permission notice shall be included in all copies or',
    '  substantial portions of the Software.',
    '',
    '  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,',
    '  INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR',
    '  PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE',
    '  FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR',
    '  OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER',
    '  DEALINGS IN THE SOFTWARE.',
    '',
    "Its decoder (dec/) is Google's Brotli decoder. Each of its files is headed:",
    '',
    '  Copyright 2013 Google Inc. All Rights Reserved.',
    '  Licensed under the Apache License, Version 2.0.',
    '',
    "The Apache License 2.0 text is in this product's LICENSE file. We modify dec/decode.js",
    '(patches/brotli@1.3.3.patch, marked "canvas"): a block that would write past the',
    'output buffer is refused instead of growing it.',
  ].join('\n'),
};

/**
 * Code compiled into a package from another project whose licence the package does not ship,
 * keyed by `name@version`: the project's licence file, committed under `scripts/notices/`, and a
 * string the package's file must contain, so an upgrade that changes the embedded version fails
 * here until the notice is checked again.
 */
const EMBEDDED: Readonly<
  Record<string, { title: string; notice: string; file: string; marker: string }>
> = {
  'harfbuzzjs@1.6.2': {
    title: 'HarfBuzz 14.5.0, compiled into dist/harfbuzz.wasm',
    notice: 'harfbuzz-14.5.0-COPYING.txt',
    file: 'dist/harfbuzz.wasm',
    marker: '14.5.0',
  },
};

function normalise(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function licenseTextOf(dir: string, manifest: Manifest): string {
  const key = `${manifest.name}@${manifest.version}`;
  const files = readdirSync(dir)
    .filter((entry) => /^(licen[cs]e|copying)([._-]|$)/iu.test(entry))
    .sort();
  let text: string;
  if (files.length === 0) {
    const recorded = NO_LICENSE_FILE[key];
    if (recorded === undefined) throw new Error(`${key} ships no licence file`);
    text = recorded;
  } else {
    const texts = files.map((file) => normalise(readFileSync(join(dir, file), 'utf8')));
    text =
      files.length === 1
        ? texts.join('')
        : files.map((file, index) => `--- ${file} ---\n\n${texts[index] ?? ''}`).join('\n\n');
  }
  const embedded = EMBEDDED[key];
  if (embedded !== undefined) {
    if (!readFileSync(join(dir, embedded.file)).includes(embedded.marker)) {
      throw new Error(`${key}: ${embedded.file} no longer contains ${embedded.marker}`);
    }
    const notice = readFileSync(new URL(`notices/${embedded.notice}`, import.meta.url), 'utf8');
    text += `\n\n--- ${embedded.title} ---\n\n${normalise(notice)}`;
  }
  return text;
}

/**
 * Collects the third-party packages the given workspace packages depend on at run time:
 * `dependencies`, followed transitively; workspace packages are walked through, not listed.
 *
 * @param rootDir - The repository root.
 * @param packageDirs - The workspace packages, relative to `rootDir`.
 * @returns Each third-party package once, sorted by name, then version.
 * @throws {Error} When a dependency is missing, declares no licence or ships no licence file.
 */
export function collectThirdParty(
  rootDir: string,
  packageDirs: readonly string[],
): ThirdPartyPackage[] {
  const found = new Map<string, ThirdPartyPackage>();
  const visited = new Set<string>();
  const workspaceDirs = new Set(packageDirs.map((dir) => realpathSync(resolve(rootDir, dir))));
  const queue = [...workspaceDirs];
  for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
    if (visited.has(dir)) continue;
    visited.add(dir);
    const manifest = readManifest(dir);
    // Installed packages live under node_modules; workspace packages are walked through.
    if (dir.includes('/node_modules/')) {
      found.set(`${manifest.name}@${manifest.version}`, {
        name: manifest.name,
        version: manifest.version,
        license: licenseOf(manifest),
        licenseText: licenseTextOf(dir, manifest),
      });
    }
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      queue.push(resolveDependency(name, dir));
    }
  }
  return [...found.values()].sort(
    (a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'),
  );
}

/**
 * Renders THIRD_PARTY_LICENSES.md.
 *
 * @param packages - The third-party packages, as {@link collectThirdParty} returns them.
 * @returns The file's text.
 */
export function renderThirdPartyLicenses(packages: readonly ThirdPartyPackage[]): string {
  const sections = packages.map(
    (pkg) =>
      `## ${pkg.name} ${pkg.version}\n\nLicence: ${pkg.license}\n\n` +
      '```text\n' +
      pkg.licenseText +
      '\n```\n',
  );
  return (
    '# Third-party licences\n\n' +
    'The npm packages the SDK bundles, with the licence text each one ships. Generated by\n' +
    '`packages/sdk/scripts/third-party-licenses.ts` from the installed packages; do not edit.\n' +
    'Fonts carry their own licence files beside them (see NOTICE).\n\n' +
    sections.join('\n')
  );
}

/**
 * The list as it should be committed, generated from node_modules.
 *
 * @returns THIRD_PARTY_LICENSES.md's text.
 */
export function currentThirdPartyLicenses(): string {
  return renderThirdPartyLicenses(collectThirdParty(ROOT_DIR, OPEN_PACKAGES));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = currentThirdPartyLicenses();
  if (process.argv.includes('--check')) {
    const committed = existsSync(THIRD_PARTY_FILE) ? readFileSync(THIRD_PARTY_FILE, 'utf8') : '';
    if (committed !== text) {
      process.stderr.write(
        'THIRD_PARTY_LICENSES.md is stale: run `pnpm --filter @ilkal/sdk licenses`\n',
      );
      process.exitCode = 1;
    }
  } else {
    writeFileSync(THIRD_PARTY_FILE, text);
  }
}
