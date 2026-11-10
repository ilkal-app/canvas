import { useEffect, useRef } from 'react';

import type { ObjectId } from '@canvas/schema';

import type { ThemePreference } from '../theme/theme-preference.js';

/** What the shell tells its host as the person works (the SDK's events). */
export interface HostEventProps {
  /**
   * Receives the selected objects' ids after each change of the selection, the empty list when
   * nothing is selected; not called for the selection the shell starts with.
   */
  readonly onSelectionChange?: (ids: readonly ObjectId[]) => void;
  /**
   * Receives the theme preference after each change of it (the person's choice in the board
   * menu, or a new starting preference a shell-scoped theme follows); not called for the one the
   * shell starts with.
   */
  readonly onThemePreferenceChange?: (preference: ThemePreference) => void;
  /**
   * Called each time the shell's engine has mounted on the board, with its undo history:
   * from then on the person's undo takes back the commands run on the board's store, an agent's
   * they operate among them.
   */
  readonly onEngineMount?: () => void;
  /**
   * Whether the shell keeps the page shown in the page's own address (`?page=`), and
   * opens the page it names; true if absent. False for a host that embeds the shell (the SDK,
   *): the address bar is the host's, which the board leaves alone.
   */
  readonly isPageInAddress?: boolean;
}

/**
 * Calls a callback with a value after each change of it, never for the first.
 *
 * @param value - The value now; compared by identity.
 * @param callback - The host's callback, the latest one given.
 */
function useTellChanges<Value>(value: Value, callback: ((value: Value) => void) | undefined): void {
  const latest = useRef(callback);
  latest.current = callback;
  const told = useRef(value);
  useEffect(() => {
    if (Object.is(told.current, value)) return;
    told.current = value;
    latest.current?.(value);
  }, [value]);
}

/**
 * Tells the host each change of the selection and of the theme preference, once per change (the
 * panel model hands the same selection list until the selection changes), and each mount of the
 * engine.
 *
 * @param props - The host's callbacks.
 * @param selectedIds - The selection now.
 * @param themePreference - The theme preference now.
 * @param engine - The mounted engine, or `undefined` while there is none.
 */
export function useHostEvents(
  props: HostEventProps,
  selectedIds: readonly ObjectId[],
  themePreference: ThemePreference,
  engine: object | undefined,
): void {
  useTellChanges(selectedIds, props.onSelectionChange);
  useTellChanges(themePreference, props.onThemePreferenceChange);
  const onEngineMount = useRef(props.onEngineMount);
  onEngineMount.current = props.onEngineMount;
  useEffect(() => {
    if (engine !== undefined) onEngineMount.current?.();
  }, [engine]);
}
