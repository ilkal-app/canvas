import { LocalFontChecker } from './local-font-check.js';
import { LocalFontSource, type LocalFace } from './local-font-source.js';
import { pageFontLoader, loadPageFonts } from './page-fonts.js';

let source: LocalFontSource | undefined;
/** The families this page installed from this computer. */
const installed = new Set<string>();
/** The families a restore is installing now. */
const restoring = new Set<string>();
/** The listing a restore in progress is waiting for. */
let listing: Promise<readonly string[]> | undefined;

/** Whether this page may read installed fonts: as the browser reports it, without asking. */
export type LocalFontPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

/**
 * Reads capability without prompting. The browser API itself enforces permission.
 *
 * @returns Whether this browser exposes Local Font Access.
 */
export function supportsLocalFonts(): boolean {
  return typeof (globalThis as { queryLocalFonts?: unknown }).queryLocalFonts === 'function';
}

/**
 * The page's Local Font Access permission, read without prompting and without listing fonts:
 * `unsupported` in a browser without the API, `prompt` when the browser cannot say.
 *
 * @returns The permission state.
 */
export async function localFontPermission(): Promise<LocalFontPermission> {
  if (!supportsLocalFonts()) return 'unsupported';
  const permissions = (globalThis as { navigator?: { permissions?: Permissions } }).navigator
    ?.permissions;
  if (permissions === undefined) return 'prompt';
  try {
    return (await permissions.query({ name: 'local-fonts' as PermissionName })).state;
  } catch {
    return 'prompt';
  }
}

/**
 * The page's source of local fonts, made on first use.
 *
 * @returns The source.
 */
function localSource(): LocalFontSource {
  if (source !== undefined) return source;
  const host = globalThis as unknown as { queryLocalFonts(): Promise<readonly LocalFace[]> };
  // Each local file is read in a worker before the page parses it.
  const checker = new LocalFontChecker();
  source = new LocalFontSource(() => host.queryLocalFonts(), {
    check: (bytes) => checker.check(bytes),
  });
  return source;
}

/**
 * Requests local metadata from an explicit button press.
 *
 * @returns Installed family names; bytes are still unread.
 */
export function requestLocalFonts(): Promise<readonly string[]> {
  return localSource().list();
}

/**
 * Validates and installs a family into the page/worker renderer only.
 *
 * @param family - Enumerated family.
 * @returns Settles after installation, rejecting unsupported outlines.
 */
export async function loadLocalFont(family: string): Promise<void> {
  if (source === undefined) throw new Error('Choose Allow local fonts first.');
  const files = await source.load(family);
  await loadPageFonts().loaded;
  const loader = pageFontLoader();
  loader.installLocal(family, files);
  // A family the catalogue already holds keeps its catalogue faces, so it is not marked local.
  if (loader.isLocal(family)) installed.add(family);
}

/**
 * Installs the given families from this computer when the person already let the page read
 * installed fonts, so a board's local fonts draw after a reload without anyone opening
 * the picker. Never asks for permission, and never fetches or uploads anything: without a granted
 * permission it lists nothing. Families not installed here, or with no supported face, are left.
 *
 * @param families - The families the board needs.
 * @returns The families installed, in the order asked for.
 */
export async function restoreLocalFonts(families: readonly string[]): Promise<readonly string[]> {
  // Reserved before any await, so overlapping restores never install a family twice.
  const wanted = families.filter((family) => !restoring.has(family));
  if (wanted.length === 0) return [];
  for (const family of wanted) restoring.add(family);
  try {
    if ((await localFontPermission()) !== 'granted') return [];
    // Trackers opened together (a board's notices mounting twice) share one listing.
    listing ??= localSource()
      .list()
      .finally(() => {
        listing = undefined;
      });
    const available = new Set(await listing);
    const restored: string[] = [];
    for (const family of wanted) {
      if (!available.has(family)) continue;
      try {
        await loadLocalFont(family);
        restored.push(family);
      } catch {
        // Unsupported outlines: the family stays missing.
      }
    }
    return restored;
  } finally {
    for (const family of wanted) restoring.delete(family);
  }
}

/**
 * Whether this page installed a family from this computer, so the picker marks it.
 *
 * @param family - The family.
 * @returns True once it was installed from Local Font Access.
 */
export function isLocalFamily(family: string): boolean {
  return installed.has(family);
}
