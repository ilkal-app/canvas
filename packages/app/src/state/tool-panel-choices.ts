import type { ToolPanelId } from './tool-panel-state.js';
import type { PreferenceStorage } from './view-preferences.js';

/**
 * How one tool panel's choices are kept: their defaults, and how to read back what
 * was stored. Each panel brings its own (Shapes, Connector, Sticky here; Draw and Reactions from
 * their lanes), so a panel is added without touching another's.
 *
 * @template T - The panel's choices.
 */
export interface ToolPanelChoiceCodec<T> {
  /** The panel. */
  readonly id: ToolPanelId;
  /** The choices before the person makes any: what new objects get by default. */
  readonly defaults: T;
  /**
   * Reads stored choices back: every field that is missing or not valid takes its default, so a
   * stored value from an older or newer build never fails. Pure; never throws.
   *
   * @param stored - The parsed JSON that was stored, of any shape.
   * @returns The choices.
   */
  readonly parse: (stored: unknown) => T;
}

/**
 * The `localStorage` key a panel's choices are kept under: one per panel, per person (the
 * browser's profile), not per board.
 *
 * @param id - The panel.
 * @returns The key, `canvas.tool-panel.<id>`.
 */
export function toolPanelStorageKey(id: ToolPanelId): string {
  return `canvas.tool-panel.${id}`;
}

/**
 * The page's `localStorage`, or undefined where there is none or reading it throws.
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
 * A panel's choices as the person left them: its defaults on a first visit and for anything
 * missing, malformed or unreadable.
 *
 * @param codec - The panel's codec.
 * @param storage - Where they are kept; the page's `localStorage` if absent.
 * @returns The choices.
 */
export function loadToolPanelChoices<T>(
  codec: ToolPanelChoiceCodec<T>,
  storage: PreferenceStorage | undefined = pageStorage(),
): T {
  let text: string | null | undefined;
  try {
    text = storage?.getItem(toolPanelStorageKey(codec.id));
  } catch {
    return codec.defaults;
  }
  if (text === null || text === undefined) return codec.defaults;
  let stored: unknown;
  try {
    stored = JSON.parse(text);
  } catch {
    return codec.defaults;
  }
  return codec.parse(stored);
}

/**
 * Keeps a panel's choices for the person's next visit, on any board; a storage that refuses is
 * ignored, since the choices still apply for this visit.
 *
 * @param codec - The panel's codec.
 * @param choices - The choices.
 * @param storage - Where to keep them; the page's `localStorage` if absent.
 */
export function saveToolPanelChoices<T>(
  codec: ToolPanelChoiceCodec<T>,
  choices: T,
  storage: PreferenceStorage | undefined = pageStorage(),
): void {
  try {
    storage?.setItem(toolPanelStorageKey(codec.id), JSON.stringify(choices));
  } catch {
    // Storage is a convenience: the choices still apply for this visit.
  }
}

/**
 * Reads one field of stored choices: the value when `isValid` accepts it, else the fallback.
 * For codecs' `parse`. Pure.
 *
 * @param stored - The stored choices, of any shape.
 * @param key - The field.
 * @param isValid - Whether a value is one the field may hold.
 * @param fallback - The field's default.
 * @returns The field's value.
 */
export function storedField<T>(
  stored: unknown,
  key: string,
  isValid: (value: unknown) => value is T,
  fallback: T,
): T {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return fallback;
  const value: unknown = (stored as Readonly<Record<string, unknown>>)[key];
  return isValid(value) ? value : fallback;
}
