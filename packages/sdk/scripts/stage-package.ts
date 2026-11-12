// Stages the SDK's npm package in dist/package/, which package.json's
// `publishConfig.directory` names, so `pnpm pack` packs it: the manifest publishManifest writes,
// the bundle's scripts, wasm and stylesheet, one self-contained dist/index.d.ts, the licence
// files and the README. The declarations are bundled with rollup-plugin-dts from the ones tsc
// wrote: it follows the imports into the workspace packages' built declarations (which are not
// published) and into npm packages' (zod's), and inlines what the public API uses, leaving only
// the peers (React) as imports, as the bundle does. tsc's own declarations in dist/ stay as they
// are, for the repository's project references.
//   run by `pnpm build`, after tsc
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rollup } from 'rollup';
import { dts } from 'rollup-plugin-dts';

import {
  isDeclarationExternal,
  isPublishedDistFile,
  LICENCE_FILES,
  publishManifest,
  readmeFor,
  STAGE_DIR,
  withoutWorkspaceNames,
  type Manifest,
} from './publish-package.ts';

/** The SDK's package folder. */
const SDK_DIR = fileURLToPath(new URL('..', import.meta.url));

/** The SDK's dist/. */
const DIST = join(SDK_DIR, 'dist');

/** Where the package is staged. */
const STAGE = join(SDK_DIR, STAGE_DIR);

const manifest = JSON.parse(readFileSync(join(SDK_DIR, 'package.json'), 'utf8')) as Manifest;
const peers = Object.keys(manifest.peerDependencies ?? {});

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(join(STAGE, 'dist'), { recursive: true });
for (const file of readdirSync(DIST, { recursive: true, encoding: 'utf8' })) {
  const path = file.split('\\').join('/');
  if (!isPublishedDistFile(path)) continue;
  mkdirSync(dirname(join(STAGE, 'dist', path)), { recursive: true });
  cpSync(join(DIST, path), join(STAGE, 'dist', path));
}

const bundle = await rollup({
  input: join(DIST, 'index.d.ts'),
  external: (id) => isDeclarationExternal(id, peers),
  plugins: [
    dts({
      respectExternal: true,
      // The workspace packages' built declarations (their `types`), never their sources, which
      // the repository's `development` condition would resolve.
      compilerOptions: { customConditions: [] },
    }),
  ],
  onwarn: (warning, warn) => {
    // A module the public API never reaches can be left unresolved; one it does fails the
    // consumer check (smoke-package.ts).
    if (warning.code !== 'UNRESOLVED_IMPORT') warn(warning);
  },
});
const { output } = await bundle.generate({ format: 'es' });
await bundle.close();
const [declarations, ...more] = output;
if (more.length > 0)
  throw new Error('stage-package: the declarations did not bundle into one file');
writeFileSync(join(STAGE, 'dist', 'index.d.ts'), withoutWorkspaceNames(declarations.code));

writeFileSync(
  join(STAGE, 'package.json'),
  `${JSON.stringify(publishManifest(manifest), null, 2)}\n`,
);
for (const file of LICENCE_FILES) cpSync(join(SDK_DIR, file), join(STAGE, file));
const repositoryReadme = join(SDK_DIR, '..', '..', 'README.md');
writeFileSync(
  join(STAGE, 'README.md'),
  readmeFor(
    manifest.name,
    existsSync(repositoryReadme) ? readFileSync(repositoryReadme, 'utf8') : undefined,
    readFileSync(join(SDK_DIR, 'README.md'), 'utf8'),
  ),
);
const imports = new Set(
  [...declarations.code.matchAll(/from ['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)/gu)].map(
    (match) => match[1] ?? match[2],
  ),
);
process.stdout.write(
  `stage-package: ${STAGE_DIR} staged; dist/index.d.ts imports ${[...imports].join(', ') || 'nothing'}\n`,
);
