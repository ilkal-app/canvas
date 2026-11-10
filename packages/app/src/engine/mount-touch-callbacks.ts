import type { CameraInput, TouchCallbacks } from '@canvas/tools';

import { contextMenuRequestAt } from './context-menu-request.js';
import type { EngineDocumentOptions } from './engine-document-types.js';
import type { ContextMenuRequest } from './mounted-engine.js';

/**
 * What a mount does with the select tool's touch requests:
 * the context menu opens at the press, moved into the page's viewport; a double-tap that
 * activates nothing fits the camera to the selection, or to the board when nothing is selected;
 * a finger dragging empty board, or the hand tool, pans the view. Main thread.
 *
 * @param canvas - The canvas the tool runs on.
 * @param onContextMenu - The mount's `onContextMenu`; nothing opens if absent.
 * @param input - Runs a camera input on the mount's camera.
 * @returns The callbacks for the engine document.
 */
export function mountTouchCallbacks(
  canvas: HTMLCanvasElement,
  onContextMenu: ((request: ContextMenuRequest) => void) | undefined,
  input: (input: CameraInput) => void,
): Required<Pick<TouchCallbacks, 'onContextMenu' | 'onDoubleTap'>> &
  Required<Pick<EngineDocumentOptions, 'panView'>> {
  return {
    onContextMenu: (screen, isTouch) =>
      onContextMenu?.(contextMenuRequestAt(canvas, screen, isTouch)),
    onDoubleTap: (fit) => {
      input({ kind: 'keyZoom', command: fit === 'selection' ? 'zoomToSelection' : 'zoomToFit' });
    },
    panView: (deltaXPx, deltaYPx) => {
      input({ kind: 'drag', deltaXPx, deltaYPx });
    },
  };
}
