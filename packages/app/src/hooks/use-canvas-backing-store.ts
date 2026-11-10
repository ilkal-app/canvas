import { useLayoutEffect, useRef, type RefObject } from 'react';

import type { CanvasBackingSize } from '../canvas/backing-store-size.js';
import { observeCanvasSize } from '../canvas/observe-canvas-size.js';

function isSameSize(first: CanvasBackingSize | undefined, second: CanvasBackingSize): boolean {
  return (
    first?.widthPx === second.widthPx &&
    first.heightPx === second.heightPx &&
    first.cssWidthPx === second.cssWidthPx &&
    first.cssHeightPx === second.cssHeightPx &&
    first.dpr === second.dpr
  );
}

/**
 * Sets a canvas's drawing buffer size, unless the canvas has handed its control to an
 * `OffscreenCanvas` (the engine running in a worker): its size then belongs to the worker,
 * which the size reported to `onCanvasResize` reaches, and setting it here throws.
 *
 * @param canvas - The canvas.
 * @param size - The drawing buffer size, device px.
 * @throws {DOMException} Whatever setting the size throws, other than for a handed-over canvas.
 */
function setDrawingBufferSize(canvas: HTMLCanvasElement, size: CanvasBackingSize): void {
  try {
    if (canvas.width !== size.widthPx) canvas.width = size.widthPx;
    if (canvas.height !== size.heightPx) canvas.height = size.heightPx;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'InvalidStateError')) throw error;
  }
}

/**
 * Keeps a canvas's drawing buffer (`width` and `height` attributes) equal to its on-screen size
 * in device pixels, and tells `onResize` each time it changes. The first size is applied before
 * paint. Repeated reports of the same size are dropped. Once the canvas has handed its control to
 * a worker's `OffscreenCanvas`, only `onResize` is told: the worker sizes the buffer.
 *
 * @param canvasRef - The canvas; its CSS size comes from its container.
 * @param onResize - Called with each new size; the latest function is always used.
 */
export function useCanvasBackingStore(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  onResize?: (size: CanvasBackingSize) => void,
): void {
  const onResizeRef = useRef(onResize);
  useLayoutEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    let lastSize: CanvasBackingSize | undefined;
    return observeCanvasSize(canvas, (size) => {
      if (isSameSize(lastSize, size)) return;
      lastSize = size;
      setDrawingBufferSize(canvas, size);
      onResizeRef.current?.(size);
    });
  }, [canvasRef]);
}
