import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  OPEN_FONT_LICENSE,
  OPEN_FONT_PACKAGES,
  OPEN_LICENSE,
  OPEN_PACKAGES,
} from './open-packages.ts';
import {
  collectThirdParty,
  currentThirdPartyLicenses,
  THIRD_PARTY_FILE,
} from './third-party-licenses.ts';

const ROOT_DIR = fileURLToPath(new URL('../../..', import.meta.url));
const SDK_DIR = join(ROOT_DIR, 'packages/sdk');

interface Manifest {
  name: string;
  license?: string;
  files?: string[];
  dependencies?: Record<string, string>;
}

function manifestOf(dir: string): Manifest {
  return JSON.parse(readFileSync(join(ROOT_DIR, dir, 'package.json'), 'utf8')) as Manifest;
}

/**
 * The roots of what the SDK ships: the SDK and the canvas shell, which
 * lives in `packages/app` until it is split from the site. Every workspace package they depend on
 * at run time is open too.
 */
const BUNDLED_ROOTS: readonly string[] = ['packages/sdk', 'packages/app'];

const LICENSE_TEXT = readFileSync(join(SDK_DIR, 'LICENSE'), 'utf8');

describe('the open packages', () => {
  it('carry the Apache License 2.0, with Rudr Studio as the copyright holder', () => {
    expect(LICENSE_TEXT).toContain(
      'Apache License\n                           Version 2.0, January 2004',
    );
    expect(LICENSE_TEXT).toContain('END OF TERMS AND CONDITIONS');
    expect(LICENSE_TEXT).toContain('Copyright 2026 Rudr Studio, Inc.');
  });

  it.each(OPEN_PACKAGES)('%s has the same LICENSE file and the licence field', (dir) => {
    const file = join(ROOT_DIR, dir, 'LICENSE');
    expect(existsSync(file), `${dir}/LICENSE`).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(LICENSE_TEXT);
    const manifest = manifestOf(dir);
    expect(manifest.license).toBe(OPEN_LICENSE);
    // Nothing is published from this repository: only the public repository's
    // `@ilkal/sdk`, renamed by the export, is publishable.
    if (manifest.name !== '@ilkal/sdk') {
      expect((manifest as unknown as { private?: unknown }).private).toBe(true);
    }
  });

  it.each(OPEN_FONT_PACKAGES)(
    "%s declares the fonts' licence, and ships a NOTICE beside them",
    (dir) => {
      const manifest = manifestOf(dir);
      expect(manifest.license).toBe(OPEN_FONT_LICENSE);
      expect(manifest.files).toEqual(expect.arrayContaining(['NOTICE']));
      expect(existsSync(join(ROOT_DIR, dir, 'NOTICE'))).toBe(true);
      if (!manifest.name.startsWith('@ilkal/')) {
        expect((manifest as unknown as { private?: unknown }).private).toBe(true);
      }
    },
  );

  it('include the SDK, the shell and every workspace package they bundle', () => {
    // Anchored here rather than taken from open-packages.json, so narrowing the list fails.
    const byName = new Map(
      readdirSync(join(ROOT_DIR, 'packages'), { withFileTypes: true })
        .filter((entry) => existsSync(join(ROOT_DIR, 'packages', entry.name, 'package.json')))
        .map((entry) => [manifestOf(`packages/${entry.name}`).name, `packages/${entry.name}`]),
    );
    const closure = new Set<string>();
    // The public repository's export leaves the shell out until it is split from the site: there
    // the closure of the roots present must be open; here, with every root, it is the list.
    const roots = BUNDLED_ROOTS.filter((dir) => existsSync(join(ROOT_DIR, dir, 'package.json')));
    const queue = [...roots];
    for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
      if (closure.has(dir)) continue;
      closure.add(dir);
      for (const name of Object.keys(manifestOf(dir).dependencies ?? {})) {
        const depDir = byName.get(name);
        if (depDir !== undefined) queue.push(depDir);
      }
    }
    if (roots.length === BUNDLED_ROOTS.length) {
      expect([...closure].sort()).toEqual([...OPEN_PACKAGES].sort());
    } else {
      expect(OPEN_PACKAGES).toEqual(expect.arrayContaining([...closure]));
    }
  });

  it('depend at run time only on workspace packages that are open too', () => {
    const openNames = new Set(OPEN_PACKAGES.map((dir) => manifestOf(dir).name));
    const closed = OPEN_PACKAGES.flatMap((dir) =>
      Object.keys(manifestOf(dir).dependencies ?? {})
        .filter((name) => name.startsWith('@canvas/') && !openNames.has(name))
        .map((name) => `${manifestOf(dir).name} -> ${name}`),
    );
    expect(closed).toEqual([]);
  });
});

describe('the SDK bundle', () => {
  it('ships LICENSE, NOTICE and THIRD_PARTY_LICENSES.md', () => {
    expect(manifestOf('packages/sdk').files).toEqual(
      expect.arrayContaining(['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES.md']),
    );
  });

  it('has a THIRD_PARTY_LICENSES.md generated from the installed packages', () => {
    // Stale after a dependency change: run `pnpm --filter @ilkal/sdk licenses`.
    expect(readFileSync(THIRD_PARTY_FILE, 'utf8')).toBe(currentThirdPartyLicenses());
  });

  it('names every bundled third-party package in NOTICE', () => {
    const notice = readFileSync(join(SDK_DIR, 'NOTICE'), 'utf8');
    const missing = collectThirdParty(ROOT_DIR, OPEN_PACKAGES)
      .map(({ name }) => name)
      .filter((name) => !notice.includes(name));
    expect(missing).toEqual([]);
  });
});
