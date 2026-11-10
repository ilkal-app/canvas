// Removes the test files' declarations from dist/ after `tsc -b`: tsc declares every
// file of the project, tests too, and a host has no use for them. package.json's `files` leaves
// them out of the package as well, with dist/fonts/ (the fonts package's files) and
// dist/scripts/ (the release scripts' declarations).
//   run by `pnpm build`, after tsc
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isTestDeclaration } from './dist-files.ts';

/** The SDK's dist/. */
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

const pruned = readdirSync(DIST, { recursive: true, encoding: 'utf8' }).filter((file) =>
  isTestDeclaration(file),
);
for (const file of pruned) rmSync(join(DIST, file));
process.stdout.write(`prune-dist: removed ${String(pruned.length)} test declaration files\n`);
