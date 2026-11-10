// What this package holds: the font files the SDK's build names, at the paths it names
// them by, under one folder per place they come from (the SDK's scripts/font-files.ts): `app/`
// and `engine/` for a workspace package's assets/fonts/, `npm/` for an npm package's. Pure:
// scripts/build-fonts.ts copies the files.

/** The folders the package's files may sit in, each listed in package.json's `files`. */
export const FONT_FOLDERS: readonly string[] = ['app', 'engine', 'npm'];

/**
 * The top folders of the SDK's font files that this package has no place for: none, or a
 * problem (a new place the SDK takes fonts from, missing from {@link FONT_FOLDERS} and `files`).
 *
 * @param paths - The files' paths in the package, `/`-separated.
 * @returns The folders, sorted, each once.
 */
export function unknownFolders(paths: readonly string[]): string[] {
  const folders = new Set(paths.map((path) => path.split('/')[0] ?? ''));
  return [...folders].filter((folder) => !FONT_FOLDERS.includes(folder)).sort();
}
