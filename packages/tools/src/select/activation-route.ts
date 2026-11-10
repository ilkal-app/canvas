import type { SelectIntent } from './select-intent.js';
import type { SelectToolState } from './select-tool-state.js';
import type { SelectionSource } from './selection-geometry.js';
import type { TouchCallbacks } from './touch-gestures.js';

/**
 * Where an `activate` intent (a double press) goes: `enter` the group pressed,
 * `activate` the object through the app's mode for its type (`onActivate`), or, for a finger's
 * double-tap on an object that has neither, `zoom` to it.
 */
export type ActivationRoute = 'enter' | 'activate' | 'zoom';

/**
 * Routes a double press, so a finger's double-tap is a mouse's double click wherever that does
 * something (a group not yet entered is entered, an object with a mode of its own is handed to
 * it) and zooms only where it does nothing: never both. Pure.
 *
 * @param intent - The double press.
 * @param document - The document, to read the object pressed.
 * @param state - The tool's state, for the innermost entered group.
 * @param callbacks - `canActivate`, whether an object has a mode of its own; none has if absent.
 * @returns The route.
 */
export function activationRoute(
  intent: SelectIntent & { readonly type: 'activate' },
  document: Pick<SelectionSource, 'get'>,
  state: Pick<SelectToolState, 'enteredGroupId'>,
  callbacks: Pick<TouchCallbacks, 'canActivate'>,
): ActivationRoute {
  const isGroup = document.get(intent.id)?.type === 'group';
  if (isGroup && intent.id !== state.enteredGroupId) return 'enter';
  const hasMode = callbacks.canActivate?.(intent.id) ?? false;
  return intent.pointerType === 'touch' && !isGroup && !hasMode ? 'zoom' : 'activate';
}
