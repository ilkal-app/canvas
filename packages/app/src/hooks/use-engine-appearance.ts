import { useEffect, type RefObject } from 'react';

import type { MountedEngine } from '../engine/mounted-engine.js';
import type { WhiteboardChrome } from '../shell/whiteboard-chrome.js';
import type { ThemeName } from '../theme/theme-tokens.js';

/**
 * Tells the engine the theme shown (it redraws objects' `ink`) and the shell's chrome
 * (its selection overlay follows it) whenever either changes, without a remount.
 *
 * @param engineRef - The engine, once mounted.
 * @param themeName - The theme shown.
 * @param chrome - The chrome shown.
 */
export function useEngineAppearance(
  engineRef: RefObject<MountedEngine | undefined>,
  themeName: ThemeName,
  chrome: WhiteboardChrome,
): void {
  useEffect(() => {
    engineRef.current?.setTheme(themeName);
  }, [engineRef, themeName]);
  useEffect(() => {
    engineRef.current?.setWhiteboardChrome(chrome);
  }, [engineRef, chrome]);
}
