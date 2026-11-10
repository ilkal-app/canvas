import {
  computeBackingStoreSize,
  type CanvasBackingSize,
  type PixelSize,
} from './backing-store-size.js';

function devicePixelSizeOf(entry: ResizeObserverEntry): PixelSize | undefined {
  // Absent in Safari and in older browsers; `computeBackingStoreSize` then rounds CSS × dpr.
  const box = (entry.devicePixelContentBoxSize as ResizeObserverSize[] | undefined)?.[0];
  return box === undefined ? undefined : { widthPx: box.inlineSize, heightPx: box.blockSize };
}

/**
 * Calls `onChange` whenever `window.devicePixelRatio` changes, as when a window moves to a
 * screen of another density or the page is zoomed. A resolution media query matches only the
 * current ratio, so each change re-subscribes with the new one.
 *
 * @param onChange - Called after each change.
 * @returns A function that stops watching.
 */
function watchDevicePixelRatio(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  let list: MediaQueryList | undefined;
  const handleChange = (): void => {
    onChange();
    subscribe();
  };
  const subscribe = (): void => {
    list?.removeEventListener('change', handleChange);
    list = window.matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
    list.addEventListener('change', handleChange);
  };
  subscribe();
  return () => {
    list?.removeEventListener('change', handleChange);
  };
}

/**
 * Reports a canvas's CSS size and drawing buffer size now and whenever either changes: on
 * layout changes through `ResizeObserver` (in device pixels where the browser supports
 * `device-pixel-content-box`), and on device pixel ratio changes. Without `ResizeObserver` it
 * reports once. It never writes to the canvas; the caller decides what to do with a size.
 *
 * @param canvas - The canvas to watch; its CSS size is set by its container.
 * @param onSize - Called with each size, including the first, synchronously on subscribe.
 * @returns A function that stops watching.
 */
export function observeCanvasSize(
  canvas: HTMLCanvasElement,
  onSize: (size: CanvasBackingSize) => void,
): () => void {
  const report = (cssSize?: PixelSize, devicePixelSize?: PixelSize): void => {
    const rect = canvas.getBoundingClientRect();
    const css = cssSize ?? { widthPx: rect.width, heightPx: rect.height };
    onSize(computeBackingStoreSize(css, window.devicePixelRatio, devicePixelSize));
  };
  report();
  const stops = [
    watchDevicePixelRatio(() => {
      report();
    }),
  ];
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      report({ widthPx: width, heightPx: height }, devicePixelSizeOf(entry));
    });
    try {
      observer.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      // Browsers without device-pixel-content-box throw on the unknown box; fall back.
      observer.observe(canvas);
    }
    stops.push(() => {
      observer.disconnect();
    });
  }
  return () => {
    for (const stop of stops) stop();
  };
}
