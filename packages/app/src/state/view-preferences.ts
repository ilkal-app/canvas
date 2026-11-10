import { announceViewPreferences } from './view-preference-channel.js';

/**
 * The person's view preferences: whether the dot
 * grid shows and whether drags snap; and how a delete treats attached connectors.
 * They belong to the person, not the board: kept in the browser's `localStorage`, never in the
 * document (a board setting would change the stored layout).
 */
export interface ViewPreferences {
  /** Whether the dot grid shows behind the board (mod+'). */
  readonly isGridVisible: boolean;
  /** Whether moves and resizes snap to objects, and to the grid while it shows (mod+shift+'). */
  readonly isSnappingOn: boolean;
  /**
   * Whether deleting objects deletes the connectors attached to them too ("delete connectors
   * with their objects"), rather than detaching them, whose ends then stay where they were.
   */
  readonly shouldDeleteConnectors: boolean;
}

/**
 * A first visit's preferences: snapping to objects' edges and centres, with guides, on (mod+shift+'
 * turns it off); the dot grid, and so snapping to it, off (mod+'); a delete detaches attached
 * connectors (the default).
 */
export const DEFAULT_VIEW_PREFERENCES: ViewPreferences = Object.freeze({
  isGridVisible: false,
  isSnappingOn: true,
  shouldDeleteConnectors: false,
});

/** The `localStorage` key the preferences are kept under, as JSON. */
export const VIEW_PREFERENCES_STORAGE_KEY = 'canvas.view-preferences';

/** The part of `Storage` the preferences use, so tests pass a map. */
export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

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
 * Reads the preferences, falling back to {@link DEFAULT_VIEW_PREFERENCES} field by field for
 * anything missing, malformed or unreadable (storage that throws, as in a private window, is
 * treated as empty).
 *
 * @param storage - Where they are kept; the page's `localStorage` if absent.
 * @returns The preferences.
 */
export function loadViewPreferences(
  storage: PreferenceStorage | undefined = pageStorage(),
): ViewPreferences {
  try {
    const stored: unknown = JSON.parse(storage?.getItem(VIEW_PREFERENCES_STORAGE_KEY) ?? 'null');
    if (typeof stored !== 'object' || stored === null) return DEFAULT_VIEW_PREFERENCES;
    const fields = stored as Record<string, unknown>;
    const read = (name: keyof ViewPreferences): boolean => {
      const value = fields[name];
      return typeof value === 'boolean' ? value : DEFAULT_VIEW_PREFERENCES[name];
    };
    return {
      isGridVisible: read('isGridVisible'),
      isSnappingOn: read('isSnappingOn'),
      shouldDeleteConnectors: read('shouldDeleteConnectors'),
    };
  } catch {
    return DEFAULT_VIEW_PREFERENCES;
  }
}

/**
 * Keeps the preferences for the person's next visit; a storage that refuses (full, disabled) is
 * ignored, since the preferences still apply for this visit. Every surface listening on the page
 * hears them (`subscribeViewPreferences`).
 *
 * @param preferences - The preferences.
 * @param storage - Where to keep them; the page's `localStorage` if absent.
 */
export function saveViewPreferences(
  preferences: ViewPreferences,
  storage: PreferenceStorage | undefined = pageStorage(),
): void {
  try {
    storage?.setItem(
      VIEW_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        isGridVisible: preferences.isGridVisible,
        isSnappingOn: preferences.isSnappingOn,
        shouldDeleteConnectors: preferences.shouldDeleteConnectors,
      }),
    );
  } catch {
    // Storage is a convenience: the preference holds for this visit either way.
  }
  announceViewPreferences(preferences);
}
