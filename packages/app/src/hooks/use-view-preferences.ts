import { useCallback, useEffect, useState } from 'react';

import {
  requestViewPreferences,
  subscribeViewPreferences,
  type ViewPreferenceRequest,
} from '../state/view-preference-channel.js';
import { loadViewPreferences, type ViewPreferences } from '../state/view-preferences.js';

/** The person's view preferences as {@link useViewPreferences} gives them, and their change. */
export interface ViewPreferenceControls {
  /** The preferences as last saved on this device. */
  readonly preferences: ViewPreferences;
  /** Asks the mounted shell to change them (`requestViewPreferences`). */
  readonly request: (request: ViewPreferenceRequest) => void;
}

/**
 * The person's view preferences for a surface outside the shell (Board settings' Grid
 * and Snapping): stored ones to start, then every save on the page (the shell's, a shortcut's
 * included); a change shows at once and is asked of the mounted shell, which applies and saves
 * it.
 *
 * @returns The preferences and their change.
 */
export function useViewPreferences(): ViewPreferenceControls {
  const [preferences, setPreferences] = useState<ViewPreferences>(() => loadViewPreferences());
  useEffect(() => subscribeViewPreferences(setPreferences), []);
  // Shown as asked at once, so a switch moves with the click; the shell's save confirms it.
  const request = useCallback((change: ViewPreferenceRequest) => {
    setPreferences((current) => ({ ...current, ...change }));
    requestViewPreferences(change);
  }, []);
  return { preferences, request };
}
