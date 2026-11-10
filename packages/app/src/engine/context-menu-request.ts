import type { ScreenPoint } from '@canvas/tools';

import type { ContextMenuRequest } from './mounted-engine.js';

/**
 * A press on the canvas as a context menu request: the canvas's point moved into the page's
 * viewport, where the shell places the menu. Main thread.
 *
 * @param canvas - The canvas pressed.
 * @param screen - The press, CSS px on the canvas.
 * @param isTouch - Whether a finger's long-press asked; false if absent.
 * @returns The request, CSS px in the viewport.
 */
export function contextMenuRequestAt(
  canvas: HTMLCanvasElement,
  screen: ScreenPoint,
  isTouch = false,
): ContextMenuRequest {
  const box = canvas.getBoundingClientRect();
  return {
    clientX: box.left + screen.x,
    clientY: box.top + screen.y,
    ...(isTouch ? { isTouch: true } : {}),
  };
}
