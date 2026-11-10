import type { ViewPreferences } from './view-preferences.js';

/** The view preferences a surface outside the shell may ask to change. */
export type ViewPreferenceRequest = Partial<
  Pick<ViewPreferences, 'isGridVisible' | 'isSnappingOn'>
>;

const savedListeners = new Set<(preferences: ViewPreferences) => void>();
const requestListeners = new Set<(request: ViewPreferenceRequest) => void>();

/**
 * Hears every save of the person's view preferences on the page (`saveViewPreferences`: the
 * shell's, after a shortcut or a toggle), so a surface outside the shell (the site's Board
 * settings) shows them as they are.
 *
 * @param listener - Receives the preferences saved.
 * @returns Stops listening.
 */
export function subscribeViewPreferences(
  listener: (preferences: ViewPreferences) => void,
): () => void {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
}

/**
 * Tells the page's listeners that the view preferences were saved (`saveViewPreferences` calls
 * it).
 *
 * @param preferences - The preferences saved.
 */
export function announceViewPreferences(preferences: ViewPreferences): void {
  for (const listener of [...savedListeners]) listener(preferences);
}

/**
 * Asks the mounted shell to change the person's view preferences (Board settings, which
 * sits outside the shell): the shell applies each field that differs through its own toggle, so
 * the engine and storage follow as for a shortcut.
 *
 * @param request - The fields to change.
 */
export function requestViewPreferences(request: ViewPreferenceRequest): void {
  for (const listener of [...requestListeners]) listener(request);
}

/**
 * Hears requests to change the view preferences ({@link requestViewPreferences}): the shell's
 * state does.
 *
 * @param listener - Receives each request.
 * @returns Stops listening.
 */
export function subscribeViewPreferenceRequests(
  listener: (request: ViewPreferenceRequest) => void,
): () => void {
  requestListeners.add(listener);
  return () => {
    requestListeners.delete(listener);
  };
}
