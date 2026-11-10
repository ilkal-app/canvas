// Fills this package with the SDK's font files: the SDK's build emits every font file
// the bundle names, with the licence files beside them, into its dist/fonts/
// (packages/sdk/scripts/font-files.ts, which fails the build when a name has no file); this
// copies that folder here, as it is, replacing what an earlier build left. Run after the SDK's
// build: `pnpm build` orders it so (a dev dependency).
//   pnpm --filter @ilkal/fonts build
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FONT_FOLDERS, unknownFolders } from '../src/font-folders.ts';

/** This package's folder. */
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

/** The SDK's built font files. */
const SDK_FONTS = fileURLToPath(new URL('../node_modules/@ilkal/sdk/dist/fonts', import.meta.url));

if (!existsSync(SDK_FONTS)) {
  process.stderr.write(`build-fonts: no ${SDK_FONTS}: build @ilkal/sdk first\n`);
  process.exit(1);
}
const paths = readdirSync(SDK_FONTS, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(SDK_FONTS, join(entry.parentPath, entry.name)).split('\\').join('/'));
const unknown = unknownFolders(paths);
if (unknown.length > 0) {
  process.stderr.write(
    `build-fonts: the SDK's fonts sit in folders this package does not list: ${unknown.join(', ')}\n`,
  );
  process.exit(1);
}
for (const folder of FONT_FOLDERS)
  rmSync(join(PACKAGE_DIR, folder), { recursive: true, force: true });
cpSync(SDK_FONTS, PACKAGE_DIR, { recursive: true });
const fonts = paths.filter((path) => /\.(?:ttf|otf|woff2?)$/u.test(path)).length;
process.stdout.write(
  `build-fonts: copied ${String(fonts)} font files and ${String(paths.length - fonts)} licence files\n`,
);
