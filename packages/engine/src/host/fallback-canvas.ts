// The canvas the engine switches to after a WebGPU loss: a canvas that had a WebGPU
// context can never have a WebGL2 one, so the engine draws on a fresh canvas laid over the
// original. The original stays where it is, transparent, and keeps every listener the page bound
// to it (pointer, touch, clipboard), since the fallback lets input through. It is hidden with
// `opacity`, not `visibility`: a `visibility: hidden` element is never the target of a pointer
// event, so the page's input would stop.
import type { EngineCanvas } from './engine-host-platform.js';

/** The page-canvas features the fallback needs; a canvas without them cannot be overlaid. */
interface PageCanvas extends EngineCanvas {
  readonly style: Record<string, string>;
  readonly ownerDocument: { createElement(tag: 'canvas'): unknown };
  after(node: unknown): void;
  setAttribute?(name: string, value: string): void;
  remove?(): void;
  readonly offsetLeft?: number;
  readonly offsetTop?: number;
  readonly clientWidth?: number;
  readonly clientHeight?: number;
}

/** Each overlaid original's opacity before the overlay, restored when the fallback goes. */
const originalOpacity = new WeakMap<object, string>();

/**
 * Whether a canvas is a page canvas the fallback can be laid over.
 *
 * @param canvas - The canvas.
 * @returns True for a page canvas in a document.
 */
function isPageCanvas(canvas: EngineCanvas): canvas is PageCanvas {
  const page = canvas as Partial<PageCanvas>;
  return (
    typeof page.after === 'function' &&
    typeof page.ownerDocument?.createElement === 'function' &&
    typeof page.style === 'object'
  );
}

/**
 * Lays a fresh canvas over a page canvas: inserted right after it, absolutely positioned on its
 * box, letting input through to it, at its drawing-buffer size; the original turns transparent.
 *
 * @param original - The page canvas the engine drew on.
 * @returns The fallback canvas, or `undefined` when the canvas is not a page canvas (an
 *   `OffscreenCanvas` cannot be overlaid).
 */
export function overlayFallbackCanvas(original: EngineCanvas): EngineCanvas | undefined {
  if (!isPageCanvas(original)) return undefined;
  const fallback = original.ownerDocument.createElement('canvas') as PageCanvas;
  fallback.width = original.width;
  fallback.height = original.height;
  Object.assign(fallback.style, {
    position: 'absolute',
    left: `${String(original.offsetLeft ?? 0)}px`,
    top: `${String(original.offsetTop ?? 0)}px`,
    width: original.clientWidth === undefined ? '100%' : `${String(original.clientWidth)}px`,
    height: original.clientHeight === undefined ? '100%' : `${String(original.clientHeight)}px`,
    pointerEvents: 'none',
  });
  // Marks it, so the page (and its tests) can tell it from the canvas that holds the input.
  fallback.setAttribute?.('data-engine-fallback', '');
  original.after(fallback);
  if (!originalOpacity.has(original)) originalOpacity.set(original, original.style.opacity ?? '');
  original.style.opacity = '0';
  return fallback;
}

/**
 * Takes a fallback canvas off the page and gives the original back its opacity: when the host is
 * destroyed, or when the fallback could not be handed to the engine.
 *
 * @param original - The page canvas the fallback was laid over.
 * @param fallback - The fallback canvas.
 */
export function removeFallbackCanvas(original: EngineCanvas, fallback: EngineCanvas): void {
  if (isPageCanvas(fallback)) fallback.remove?.();
  if (!isPageCanvas(original)) return;
  original.style.opacity = originalOpacity.get(original) ?? '';
  originalOpacity.delete(original);
}

/**
 * Keeps a fallback canvas's CSS box on its original's after a resize.
 *
 * @param fallback - The fallback canvas.
 * @param widthPx - The drawing buffer's width.
 * @param heightPx - The drawing buffer's height.
 * @param dpr - Device pixels per CSS pixel.
 */
export function sizeFallbackCanvas(
  fallback: EngineCanvas,
  widthPx: number,
  heightPx: number,
  dpr: number,
): void {
  if (!isPageCanvas(fallback)) return;
  fallback.style.width = `${String(widthPx / dpr)}px`;
  fallback.style.height = `${String(heightPx / dpr)}px`;
}
