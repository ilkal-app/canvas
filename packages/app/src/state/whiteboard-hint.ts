import type { PreferenceStorage } from './view-preferences.js';

// The onboarding hint under a blank whiteboard's dock: shown until its first use, then
// never again in this browser.

/** The `localStorage` key that remembers the hint was dismissed. */
export const WHITEBOARD_HINT_STORAGE_KEY = 'canvas.whiteboard-hint';

/** The value stored once it is dismissed. */
const DISMISSED = 'dismissed';

/**
 * The page's `localStorage`, or undefined where there is none or reading it throws.
 *
 * @returns The storage.
 */
function pageStorage(): PreferenceStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Whether the hint was dismissed in this browser.
 *
 * @param storage - Where it is kept; the page's `localStorage` if absent.
 * @returns True once dismissed; false where storage cannot be read.
 */
export function isWhiteboardHintDismissed(
  storage: PreferenceStorage | undefined = pageStorage(),
): boolean {
  try {
    return storage?.getItem(WHITEBOARD_HINT_STORAGE_KEY) === DISMISSED;
  } catch {
    return false;
  }
}

/**
 * Remembers that the hint was dismissed.
 *
 * @param storage - Where it is kept; the page's `localStorage` if absent.
 */
export function dismissWhiteboardHint(
  storage: PreferenceStorage | undefined = pageStorage(),
): void {
  try {
    storage?.setItem(WHITEBOARD_HINT_STORAGE_KEY, DISMISSED);
  } catch {
    // Storage is a convenience: the hint still hides for this visit.
  }
}

/**
 * The hint's text, with the platform's search key.
 *
 * @param platform - Whose keys: `mac` shows ⌘F, others Ctrl+F.
 * @returns The text.
 */
export function whiteboardHintText(platform: 'mac' | 'other'): string {
  const search = platform === 'mac' ? '⌘F' : 'Ctrl+F';
  return `Press N for a sticky · Space to pan · ${search} to search`;
}
