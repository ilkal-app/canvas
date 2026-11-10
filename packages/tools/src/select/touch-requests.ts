import type { SelectIntent } from './select-intent.js';
import type { TouchCallbacks } from './touch-gestures.js';

/**
 * Hands the select tool's requests for the app to its callbacks: the
 * context menu at a point, a double-tap's zoom to fit, and a finger's pan.
 *
 * @param intent - A `contextMenu`, `doubleTap` or `pan` intent.
 * @param callbacks - Where they go; a missing callback drops its request.
 */
export function forwardTouchRequest(
  intent: Extract<SelectIntent, { readonly type: 'contextMenu' | 'doubleTap' | 'pan' }>,
  callbacks: TouchCallbacks,
): void {
  if (intent.type === 'contextMenu') {
    callbacks.onContextMenu?.(intent.screen, intent.isTouch === true);
  } else if (intent.type === 'pan') callbacks.onPan?.(intent.deltaXPx, intent.deltaYPx);
  else callbacks.onDoubleTap?.(intent.fit);
}
