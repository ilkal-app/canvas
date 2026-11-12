// What the SDK's npm package holds. The build stages it in dist/package/
// (stage-package.ts), which package.json's `publishConfig.directory` names, so `pnpm pack` packs
// the staged folder: a manifest with no workspace package in it, the bundle without its fonts,
// maps or test declarations, one self-contained declaration file, and the licence files. Pure.

/** The staged package's folder, relative to the SDK's. */
export const STAGE_DIR = 'dist/package';

/** The workspace's own scope: no published file may name it. */
export const WORKSPACE_SCOPE = '@canvas/';

/** A package.json, as far as the staging reads it. */
export interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly license?: string;
  readonly type?: string;
  readonly sideEffects?: unknown;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly repository?: unknown;
  readonly homepage?: string;
  readonly bugs?: unknown;
  readonly keywords?: readonly string[];
  readonly publishConfig?: Readonly<Record<string, unknown>>;
}

/** The files the staged package carries beside dist/. */
export const LICENCE_FILES = ['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES.md'] as const;

/**
 * The published manifest: the package's name, version and metadata, its peers, and one entry,
 * the bundle with its one declaration file. No dependencies (the bundle inlines them), no
 * devDependencies or scripts, and no `development` condition pointing at sources the package
 * does not carry. Pure.
 *
 * @param manifest - The SDK's package.json.
 * @returns The manifest to publish.
 */
export function publishManifest(manifest: Manifest): Record<string, unknown> {
  // Where pnpm packs from, and links from in the workspace, is this repository's business, not
  // the published package's.
  const publishConfig = Object.fromEntries(
    Object.entries(manifest.publishConfig ?? {}).filter(
      ([key]) => key !== 'directory' && key !== 'linkDirectory',
    ),
  );
  const optional = (key: keyof Manifest): Record<string, unknown> =>
    manifest[key] === undefined ? {} : { [key]: manifest[key] };
  return {
    name: manifest.name,
    version: manifest.version,
    ...optional('description'),
    ...optional('license'),
    ...optional('repository'),
    ...optional('homepage'),
    ...optional('bugs'),
    ...optional('keywords'),
    type: manifest.type ?? 'module',
    ...optional('sideEffects'),
    exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    main: './dist/index.js',
    types: './dist/index.d.ts',
    files: ['dist', ...LICENCE_FILES],
    ...optional('peerDependencies'),
    ...(Object.keys(publishConfig).length === 0 ? {} : { publishConfig }),
  };
}

/**
 * Whether a file of the SDK's dist/ goes into the package: the scripts, wasm and stylesheet the
 * page loads, never the fonts (their own package), the release scripts' declarations, the
 * per-module declarations (one bundled file replaces them), maps, build info or the staging
 * itself. Pure.
 *
 * @param file - Its path in dist/, `/`-separated.
 * @returns True to copy it.
 */
export function isPublishedDistFile(file: string): boolean {
  if (/^(?:fonts|scripts|package)\//u.test(file)) return false;
  return /\.(?:js|css|wasm)$/u.test(file);
}

/**
 * Whether a module the declarations import stays an import in the bundled declaration file: a
 * peer the host brings (`react`, `react-dom`, their subpaths), as the bundle leaves it; anything
 * else is inlined, as the bundle inlines it. Pure.
 *
 * @param id - The module specifier.
 * @param peers - The package's peer dependencies' names.
 * @returns True to leave it an import.
 */
export function isDeclarationExternal(id: string, peers: readonly string[]): boolean {
  return peers.some((peer) => id === peer || id.startsWith(`${peer}/`));
}

/**
 * The bundled declarations with each workspace package their inlined comments name in code
 * quotes (`` `@canvas/document` ``) named in words (the document package), since a host has no
 * such package; a mention in any other form is left for the smoke check to find. Pure.
 *
 * @param declarations - The bundled declaration file.
 * @returns It, its comments' package names in words.
 */
export function withoutWorkspaceNames(declarations: string): string {
  const scope = WORKSPACE_SCOPE.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
  return declarations.replace(new RegExp(`\`${scope}([\\w-]+)\``, 'gu'), 'the $1 package');
}

/**
 * The README the package carries: the repository's, where it is the package's own (the public
 * repository's README is titled with the package's name), else the SDK's. Pure.
 *
 * @param name - The package's name.
 * @param repositoryReadme - The repository root's README, if any.
 * @param packageReadme - The SDK's README.
 * @returns The README to ship.
 */
export function readmeFor(
  name: string,
  repositoryReadme: string | undefined,
  packageReadme: string,
): string {
  return repositoryReadme?.startsWith(`# ${name}\n`) === true ? repositoryReadme : packageReadme;
}

/**
 * The published files that name the workspace's scope: none, or a problem (a dependency a host
 * cannot install, a type it cannot resolve). Pure.
 *
 * @param files - Each file's path and its contents (binary files decoded as Latin-1).
 * @returns The paths, with how often each names it.
 */
export function workspaceMentions(
  files: readonly { readonly path: string; readonly text: string }[],
): string[] {
  return files.flatMap(({ path, text }) => {
    const count = text.split(WORKSPACE_SCOPE).length - 1;
    return count === 0 ? [] : [`${path}: ${String(count)} × ${WORKSPACE_SCOPE}`];
  });
}
