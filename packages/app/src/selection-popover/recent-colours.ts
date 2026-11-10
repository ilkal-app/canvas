/** How many recent colours a colour button keeps. */
export const RECENT_COLOURS_LIMIT = 8;

/**
 * The `localStorage` key the recent colours are kept under: per person as the tool panels'
 * choices are (`toolPanelStorageKey`), that is per browser profile, not per board or account.
 */
export const RECENT_COLOURS_STORAGE_KEY = 'canvas.recent-colours';

/**
 * The recent colours with one more used: it first, without a repeat, at most
 * {@link RECENT_COLOURS_LIMIT}. Pure.
 *
 * @param list - The recent colours, most recent first (colour button values).
 * @param value - The colour just used.
 * @returns The new list.
 */
export function withRecentColour(list: readonly string[], value: string): readonly string[] {
  return [value, ...list.filter((entry) => entry !== value)].slice(0, RECENT_COLOURS_LIMIT);
}

/**
 * The page's `localStorage`, or undefined where there is none or reading it throws.
 *
 * @returns The storage, if any.
 */
function pageStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The recent colours kept on this device: empty when there are none or they cannot be read.
 *
 * @param storage - Where they are kept; the page's `localStorage` if absent.
 * @returns The colours, most recent first, at most {@link RECENT_COLOURS_LIMIT}.
 */
export function loadRecentColours(
  storage: Pick<Storage, 'getItem'> | undefined = pageStorage(),
): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(RECENT_COLOURS_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .slice(0, RECENT_COLOURS_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Keeps the recent colours on this device; a storage that refuses is ignored.
 *
 * @param list - The colours, most recent first.
 * @param storage - Where to keep them; the page's `localStorage` if absent.
 */
export function saveRecentColours(
  list: readonly string[],
  storage: Pick<Storage, 'setItem'> | undefined = pageStorage(),
): void {
  try {
    storage?.setItem(RECENT_COLOURS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Private mode or a full quota: the list lives only for this page.
  }
}
