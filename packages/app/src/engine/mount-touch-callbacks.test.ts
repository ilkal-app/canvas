// @vitest-environment jsdom
// The whole path on a mounted engine: mount-engine-host-touch.test.ts.
import { describe, expect, it, vi } from 'vitest';

import type { CameraInput } from '@canvas/tools';

import { mountTouchCallbacks } from './mount-touch-callbacks.js';
import type { ContextMenuRequest } from './mounted-engine.js';

function canvasAt(left: number, top: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left, top } as DOMRect);
  return canvas;
}

describe('mountTouchCallbacks', () => {
  it('opens the context menu at the press moved into the viewport', () => {
    const requests: ContextMenuRequest[] = [];
    const callbacks = mountTouchCallbacks(
      canvasAt(100, 50),
      (request) => requests.push(request),
      () => undefined,
    );
    callbacks.onContextMenu({ x: 10, y: 20 }, false);
    // A finger's long-press says so (on a phone it may open reactions instead).
    callbacks.onContextMenu({ x: 10, y: 20 }, true);
    expect(requests).toEqual([
      { clientX: 110, clientY: 70 },
      { clientX: 110, clientY: 70, isTouch: true },
    ]);
  });

  it('fits the selection, or the board, on a double-tap, and pans for a drag', () => {
    const inputs: CameraInput[] = [];
    const callbacks = mountTouchCallbacks(canvasAt(0, 0), undefined, (input) => inputs.push(input));
    callbacks.onDoubleTap('selection');
    callbacks.onDoubleTap('board');
    callbacks.onContextMenu({ x: 1, y: 1 }, false);
    callbacks.panView(12, -4);
    expect(inputs).toEqual([
      { kind: 'keyZoom', command: 'zoomToSelection' },
      { kind: 'keyZoom', command: 'zoomToFit' },
      { kind: 'drag', deltaXPx: 12, deltaYPx: -4 },
    ]);
  });
});
