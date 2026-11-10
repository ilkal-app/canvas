// The shell is the open part of this package: the canvas, its toolbar,
// panels, dialogs and theming, which the SDK bundles and the public repository carries. The site
// is the private rest: the board list, sign-in, billing, admin, the landing page and the brand.
// The shell never imports the site, so the SDK's bundle and the exported source hold none of it.
// This reads every shell file, tests and fixtures included (the public repository carries them
// too), and rejects an import, static or dynamic, or a module mock that reaches a site folder. The boards service's client the shell's comments and votes
// speak through (its transport, errors, readers and people) lives in the shell's `service/`.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** The package's `src/` folder. */
const SRC = fileURLToPath(new URL('..', import.meta.url));

/** The folders of `src/` that belong to the site, not the shell. */
const SITE_FOLDERS: ReadonlySet<string> = new Set([
  'site',
  'admin',
  'landing',
  'brand',
  'bench',
  'history',
  'thumbnails',
  // The deployable app's entry and the scenario harness's page, set in the site's fonts.
  'playground',
]);

/**
 * An import's specifier, in any quotes: `from '…'` (an import or a re-export, on its own line when
 * the names span lines), `import '…'`, `import('…')` with comments before the literal, or a test's
 * `vi.mock('…')`.
 */
const IMPORT =
  /(?:\bfrom\s+|\bvi\.mock\s*\(\s*|\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*|^\s*import\s+)(['"`])([^'"`]+)\1/gmu;

/**
 * Whether a path from `src/` is site material.
 *
 * @param path - The path, with forward slashes.
 * @returns True for a file in a site folder or one of the site's own files.
 */
function isSitePath(path: string): boolean {
  return SITE_FOLDERS.has(path.split('/')[0] ?? '');
}

/** This file, whose own examples name site paths. */
const THIS_FILE = 'shell/shell-boundary.test.ts';

/** Every shell file, tests and fixtures included, by its path from `src/`, with its text. */
const SHELL_FILES: readonly (readonly [string, string])[] = readdirSync(SRC, {
  recursive: true,
  encoding: 'utf8',
})
  .map((path) => path.split('\\').join('/'))
  .filter((path) => /\.tsx?$/u.test(path) && !isSitePath(path) && path !== THIS_FILE)
  .map((path) => [path, readFileSync(join(SRC, path), 'utf8')] as const);

/**
 * The site files a shell file imports.
 *
 * @param path - The shell file's path from `src/`.
 * @param text - Its text.
 * @returns Each relative import that lands in the site, as a path from `src/`.
 */
function siteImportsOf(path: string, text: string): readonly string[] {
  return [...text.matchAll(IMPORT)]
    .map((match) => match[2] ?? '')
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) =>
      relative(SRC, normalize(join(SRC, dirname(path), specifier.replace(/\?.*$/u, ''))))
        .split('\\')
        .join('/'),
    )
    .filter(isSitePath);
}

describe('the shell and the site', () => {
  it('finds the shell files to check', () => {
    expect(SHELL_FILES.length).toBeGreaterThan(500);
    expect(SHELL_FILES.some(([path]) => path === 'shell/app-shell.tsx')).toBe(true);
  });

  it('never imports the site from the shell', () => {
    const reaches = Object.fromEntries(
      SHELL_FILES.map(
        ([path, text]) => [path, [...new Set(siteImportsOf(path, text))].sort()] as const,
      ).filter(([, targets]) => targets.length > 0),
    );
    expect(reaches).toEqual({});
  });

  it('reads static, dynamic and side-effect imports', () => {
    const text = [
      "import { a } from '../site/a.js';",
      "export { b } from '../brand/b.js';",
      "const c = import('../landing/c.js');",
      "import '../admin/d.css';",
      "import { e } from './local.js';",
      "import { f } from '@canvas/schema';",
      "vi.mock('../site/g.js', () => ({}));",
    ].join('\n');
    expect(siteImportsOf('shell/x.ts', text)).toEqual([
      'site/a.js',
      'brand/b.js',
      'landing/c.js',
      'admin/d.css',
      'site/g.js',
    ]);
  });

  it('reads multi-line imports, other quotes, queries and commented dynamic imports', () => {
    const text = [
      'import {',
      '  a,',
      '  b,',
      '} from "../site/a.js";',
      "import styles from '../history/h.module.css?raw';",
      'const c = import(/* webpackChunkName: "c" */ `../bench/c.js`);',
      'const d = import(',
      '  // the site, later',
      "  '../thumbnails/d.js'",
      ');',
    ].join('\n');
    expect(siteImportsOf('shell/x.ts', text)).toEqual([
      'site/a.js',
      'history/h.module.css',
      'bench/c.js',
      'thumbnails/d.js',
    ]);
  });

  it("knows the site's entry by its import's .js name as well as its source name", () => {
    expect(siteImportsOf('shell/x.ts', "import '../playground/main.js';")).toEqual([
      'playground/main.js',
    ]);
    expect(siteImportsOf('shell/x.ts', "import m from '../playground/main.js?raw';")).toEqual([
      'playground/main.js',
    ]);
    expect(isSitePath('playground/main.tsx')).toBe(true);
    expect(isSitePath('shell/app-shell.tsx')).toBe(false);
  });
});
