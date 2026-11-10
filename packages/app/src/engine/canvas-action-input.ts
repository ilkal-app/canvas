import type { CameraInput } from '@canvas/tools';

import type { CanvasAction } from '../state/shell-action.js';

/**
 * The camera input a shell action means, for the actions the camera owns: the zoom and fit
 * shortcuts, a frame, zooming to a main the inspector went to
 * or a search result, and the arrow-key nudges, which pan the view while
 * nothing is selected (the review left keyboard pan to the camera on the `nudge`
 * action, since the arrows also nudge the selection). The mount offers a nudge to the select tool
 * first (`EngineDocument.runCanvasAction`), which moves the selection when there is one; only a
 * nudge with nothing selected reaches this mapping.
 *
 * @param action - A canvas action the shell recorded.
 * @returns The camera input, or undefined when the camera has nothing to do with the action.
 */
export function cameraInputForCanvasAction(action: CanvasAction): CameraInput | undefined {
  if (action.type === 'nudge') {
    return { kind: 'keyPan', direction: action.direction, isLarge: action.isLarge };
  }
  if (action.type === 'frame') return { kind: 'frame', bounds: action.bounds };
  // The minimap's pan: the board moves by the offset, as under a two-finger drag.
  if (action.type === 'panCamera') {
    return { kind: 'drag', deltaXPx: action.deltaXPx, deltaYPx: action.deltaYPx };
  }
  if (action.type === 'zoomCamera') {
    return {
      kind: 'pinch',
      center: { x: action.centerXPx, y: action.centerYPx },
      scale: action.scale,
    };
  }
  // Going to a main or a search result selected it on its page; the camera frames it.
  if (action.type === 'component' && action.command === 'goToMain') {
    return { kind: 'keyZoom', command: 'zoomToSelection' };
  }
  if (action.type !== 'navigate') return undefined;
  switch (action.command) {
    case 'zoomIn':
    case 'zoomOut':
    case 'zoomToActualSize':
    case 'zoomToFit':
    case 'zoomToSelection':
      return { kind: 'keyZoom', command: action.command };
    default:
      return undefined;
  }
}
