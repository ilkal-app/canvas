import type { EngineDrawingBuffer } from '../engine/mounted-engine.js';

import type { CanvasMetrics } from './canvas-harness.js';

/**
 * Measures a canvas now: its CSS box and position in the viewport, its drawing buffer and the
 * device pixel ratio. The buffer and the ratio are the engine's when it reports them (the
 * buffer it last drew into, where it runs: a canvas handed to the engine worker keeps its
 * hand-over `width` and `height` on the page), else the element's `width` and `height`, which
 * the canvas mount keeps at device resolution, and the window's ratio. Reads layout, so it may
 * force a synchronous layout; main thread only.
 *
 * @param canvas - The canvas to measure.
 * @param drawingBuffer - The engine's drawing buffer, if it has drawn.
 * @returns The canvas's metrics.
 */
export function measureCanvas(
  canvas: HTMLCanvasElement,
  drawingBuffer?: EngineDrawingBuffer,
): CanvasMetrics {
  const box = canvas.getBoundingClientRect();
  return {
    cssWidthPx: box.width,
    cssHeightPx: box.height,
    cssLeftPx: box.left,
    cssTopPx: box.top,
    widthPx: drawingBuffer?.widthPx ?? canvas.width,
    heightPx: drawingBuffer?.heightPx ?? canvas.height,
    dpr: drawingBuffer?.dpr ?? window.devicePixelRatio,
  };
}
