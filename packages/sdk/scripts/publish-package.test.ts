import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  isDeclarationExternal,
  isPublishedDistFile,
  publishManifest,
  readmeFor,
  STAGE_DIR,
  withoutWorkspaceNames,
  workspaceMentions,
  type Manifest,
} from './publish-package.ts';

/** The SDK's own package.json. */
const SDK = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as Manifest & Record<string, unknown>;

describe("the SDK's published package", () => {
  it('is packed from the staged folder, and linked in the workspace from its own', () => {
    // pnpm links a workspace package from publishConfig.directory unless told not to: the fonts
    // package's build reads the SDK's dist/fonts/, which the staged folder does not have.
    expect(SDK.publishConfig).toMatchObject({ directory: STAGE_DIR, linkDirectory: false });
  });

  it('depends on nothing, names no workspace package, and points only at what it ships', () => {
    const published = publishManifest({
      ...SDK,
      publishConfig: {
        directory: STAGE_DIR,
        linkDirectory: false,
        access: 'public',
        provenance: true,
      },
    });
    expect(published).not.toHaveProperty('dependencies');
    expect(published).not.toHaveProperty('devDependencies');
    expect(published).not.toHaveProperty('scripts');
    expect(published.exports).toEqual({
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    });
    expect(published.peerDependencies).toEqual(SDK.peerDependencies);
    expect(published.publishConfig).toEqual({ access: 'public', provenance: true });
    expect(published.files).toEqual(['dist', 'LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES.md']);
    // The workspace packages are build inputs the bundle inlines, never a host's dependencies.
    expect(Object.keys(SDK.dependencies ?? {})).toEqual([]);
    expect(JSON.stringify(published).replaceAll(SDK.name, '')).not.toContain('@canvas/');
  });

  it("ships the page's scripts, wasm and stylesheet, never the fonts, maps or declarations", () => {
    for (const file of [
      'index.js',
      'index-a.js',
      'assets/engine-worker-b.js',
      'harfbuzz.wasm',
      'index.css',
    ])
      expect(isPublishedDistFile(file), file).toBe(true);
    for (const file of [
      'fonts/app/library/x/400.ttf',
      'fonts/app/library/x/LICENSE.txt',
      'scripts/bundle-budget.d.ts',
      'package/dist/index.js',
      'mount/mount.d.ts',
      'index.d.ts',
      'index.js.map',
      'tsconfig.tsbuildinfo',
    ])
      expect(isPublishedDistFile(file), file).toBe(false);
  });

  it('leaves only the peers as imports in the bundled declarations', () => {
    const peers = ['react', 'react-dom'];
    expect(isDeclarationExternal('react', peers)).toBe(true);
    expect(isDeclarationExternal('react-dom/client', peers)).toBe(true);
    expect(isDeclarationExternal('react-dommy', peers)).toBe(false);
    expect(isDeclarationExternal('@canvas/app', peers)).toBe(false);
    expect(isDeclarationExternal('zod', peers)).toBe(false);
  });

  it('names the inlined comments’ workspace packages in words, and leaves other mentions to the check', () => {
    const declarations = [
      '/** Belongs to the command layer (`@canvas/document`), as `yieldToBrowser` in `@canvas/collab` does. */',
      'export declare const a: number;',
      // Not in code quotes: left for the check. (A package the export renames would not do.)
      '/** See @canvas/collab for the live board. */',
    ].join('\n');
    const named = withoutWorkspaceNames(declarations);
    expect(named).toContain(
      'Belongs to the command layer (the document package), as `yieldToBrowser` in the collab package does.',
    );
    expect(named).toContain('export declare const a: number;');
    expect(workspaceMentions([{ path: 'index.d.ts', text: named }])).toEqual([
      'index.d.ts: 1 × @canvas/',
    ]);
  });

  it("carries the public repository's README where it is the package's own", () => {
    expect(readmeFor('@ilkal/sdk', '# @ilkal/sdk\n\nEmbed it.', '# @ilkal/sdk\n')).toBe(
      '# @ilkal/sdk\n\nEmbed it.',
    );
    expect(readmeFor('@ilkal/sdk', '# canvas\n\nThe monorepo.', '# @ilkal/sdk\n')).toBe(
      '# @ilkal/sdk\n',
    );
    expect(readmeFor('@ilkal/sdk', undefined, '# @ilkal/sdk\n')).toBe('# @ilkal/sdk\n');
  });

  it('names each packed file that names the workspace', () => {
    expect(
      workspaceMentions([
        { path: 'package.json', text: '{"dependencies":{"@canvas/app":"0.0.0"}}' },
        { path: 'dist/index.d.ts', text: "import '@canvas/app'; import '@canvas/schema';" },
        { path: 'dist/index.js', text: 'export {};' },
      ]),
    ).toEqual(['package.json: 1 × @canvas/', 'dist/index.d.ts: 2 × @canvas/']);
  });
});
