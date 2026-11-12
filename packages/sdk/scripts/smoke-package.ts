// The package smoke check: what a host gets from npm, checked before anything is
// published. @ilkal/sdk 0.1.2 installed nowhere: its manifest named workspace packages that are
// not on npm, and its declarations imported them. This packs the SDK and the fonts package as the
// release does (`pnpm pack`), and fails when:
//   - a packed file, the manifest included, names the workspace's scope (`@canvas/`);
//   - `npm install` of the two tarballs and React into an empty project fails;
//   - a strict `tsc` of the README's calls fails there (package-smoke.ts);
//   - Node cannot resolve the SDK's entry there, or it is not a file;
//   - a font the installed SDK names is missing from the installed fonts package.
// It needs the network (npm's registry, for React). Run after `pnpm build`.
//   pnpm --filter @ilkal/sdk run smoke      the export's --verify, the public CI and release
//   ... run smoke -- --keep                 keeps the temporary folder, and prints it
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fontNamesIn } from './font-files.ts';
import { CONSUMER_TSCONFIG, consumerManifest, consumerSource } from './package-smoke.ts';
import { workspaceMentions, type Manifest } from './publish-package.ts';

/** The SDK's package folder. */
const SDK_DIR = fileURLToPath(new URL('..', import.meta.url));

/** The fonts package's folder. */
const FONTS_DIR = fileURLToPath(new URL('../../fonts', import.meta.url));

/**
 * A package's manifest.
 *
 * @param dir - Its folder.
 * @returns The manifest.
 */
function manifestOf(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest;
}

/**
 * Every file under a folder, by its path relative to it.
 *
 * @param dir - The folder.
 * @returns The paths.
 */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1));
}

/**
 * Runs a command, its output shown only when it fails.
 *
 * @param command - The program.
 * @param args - Its arguments.
 * @param cwd - Where.
 * @returns Its standard output.
 * @throws {Error} When it fails, with its output.
 */
function run(command: string, args: readonly string[], cwd: string): string {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string };
    throw new Error(
      `smoke-package: ${command} ${args.join(' ')} failed in ${cwd}\n${stdout}${stderr}`,
    );
  }
}

const isKept = process.argv.includes('--keep');
const work = mkdtempSync(join(tmpdir(), 'sdk-smoke-'));
const step = (message: string): void => {
  process.stdout.write(`smoke-package: ${message}\n`);
};
try {
  const sdk = manifestOf(SDK_DIR);
  const fonts = manifestOf(FONTS_DIR);
  const packed = join(work, 'packed');
  mkdirSync(packed);
  const tarballs = [
    { name: sdk.name, dir: SDK_DIR },
    { name: fonts.name, dir: FONTS_DIR },
  ].map(({ name, dir }) => {
    const before = new Set(readdirSync(packed));
    run('pnpm', ['pack', '--pack-destination', packed], dir);
    const [tarball] = readdirSync(packed).filter((file) => !before.has(file));
    if (tarball === undefined)
      throw new Error(`smoke-package: pnpm pack wrote no tarball for ${name}`);
    return { name, tarball: join(packed, tarball) };
  });
  step(`packed ${tarballs.map(({ tarball }) => tarball.slice(packed.length + 1)).join(', ')}`);

  const mentions = tarballs.flatMap(({ name, tarball }) => {
    const unpacked = join(work, 'unpacked', name);
    mkdirSync(unpacked, { recursive: true });
    run('tar', ['-xzf', tarball, '-C', unpacked], work);
    return workspaceMentions(
      filesUnder(unpacked).map((path) => ({
        path: `${name}: ${path}`,
        text: readFileSync(join(unpacked, path)).toString('latin1'),
      })),
    );
  });
  if (mentions.length > 0)
    throw new Error(`smoke-package: packed files name the workspace:\n  ${mentions.join('\n  ')}`);
  step('no packed file names the workspace');

  const consumer = join(work, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify(consumerManifest(tarballs, sdk.peerDependencies ?? {}), null, 2)}\n`,
  );
  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], consumer);
  step('npm install of the tarballs and React passed');

  writeFileSync(join(consumer, 'tsconfig.json'), `${JSON.stringify(CONSUMER_TSCONFIG, null, 2)}\n`);
  writeFileSync(join(consumer, 'smoke.ts'), consumerSource(sdk.name));
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  run(process.execPath, [tsc, '-p', consumer], consumer);
  step('strict tsc of the README calls passed');

  const entry = run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `process.stdout.write(import.meta.resolve(${JSON.stringify(sdk.name)}))`,
    ],
    consumer,
  );
  if (!existsSync(fileURLToPath(entry)))
    throw new Error(`smoke-package: ${sdk.name} resolves to ${entry}, which is not there`);
  step(`${sdk.name} resolves to ${entry.slice(entry.indexOf('node_modules'))}`);

  const installedSdk = join(consumer, 'node_modules', sdk.name);
  const installedFonts = join(consumer, 'node_modules', fonts.name);
  const names = new Set(
    filesUnder(installedSdk)
      .filter((path) => path.endsWith('.js'))
      .flatMap((path) => fontNamesIn(readFileSync(join(installedSdk, path), 'utf8'))),
  );
  const missing = [...names].filter((name) => !existsSync(join(installedFonts, name)));
  if (names.size === 0 || missing.length > 0)
    throw new Error(
      `smoke-package: of ${String(names.size)} fonts the SDK names, ${fonts.name} lacks ${String(missing.length)}: ${missing.slice(0, 10).join(', ')}`,
    );
  step(`${fonts.name} holds all ${String(names.size)} fonts the SDK names`);
} finally {
  if (isKept) step(`kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
