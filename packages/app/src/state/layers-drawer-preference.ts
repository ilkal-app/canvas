import type { PreferenceStorage } from './view-preferences.js';

/**
 * The `localStorage` key that keeps whether the person left the layers drawer open:
 * `open` or `closed`. A key of its own beside the view preferences, so the grid and snapping
 * entry keeps its shape.
 */
export const LAYERS_DRAWER_STORAGE_KEY = 'canvas.layers-drawer';

/**
 * The page's `localStorage`, or undefined where there is none or reading it throws (a sandboxed
 * frame, storage disabled).
 *
 * @returns The storage, or undefined.
 */
function pageStorage(): PreferenceStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Whether the person left the layers drawer open on their last visit. Closed on a first visit
 * (Figma "01 · Board at rest") and for anything missing, malformed or unreadable.
 *
 * @param storage - Where it is kept; the page's `localStorage` if absent.
 * @returns True when it was left open.
 */
export function loadLayersDrawerOpen(
  storage: PreferenceStorage | undefined = pageStorage(),
): boolean {
  try {
    return storage?.getItem(LAYERS_DRAWER_STORAGE_KEY) === 'open';
  } catch {
    return false;
  }
}

/**
 * Keeps whether the layers drawer is open for the person's next visit; a storage that refuses
 * is ignored, since the drawer still opens and closes for this visit.
 *
 * @param isOpen - Whether it is open.
 * @param storage - Where to keep it; the page's `localStorage` if absent.
 */
export function saveLayersDrawerOpen(
  isOpen: boolean,
  storage: PreferenceStorage | undefined = pageStorage(),
): void {
  try {
    storage?.setItem(LAYERS_DRAWER_STORAGE_KEY, isOpen ? 'open' : 'closed');
  } catch {
    // Storage is a convenience: the drawer still follows the toggle for this visit.
  }
}
