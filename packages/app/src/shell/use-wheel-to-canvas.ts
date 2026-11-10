import { useEffect, type RefObject } from 'react';

/** Popups over the bars that scroll on their own: the wheel stays theirs. */
const OWN_SCROLL_SELECTOR = '[role="menu"], [role="listbox"]';

/**
 * Hands the wheel over chrome floating on the canvas to the canvas: a wheel, a
 * Control-wheel or a trackpad pinch over the top bars pans and zooms the board as it would a
 * pixel beside them, instead of doing nothing or zooming the page. The event is re-dispatched on
 * the canvas with its position and modifiers, and the original's default is prevented; a wheel
 * over one of the bars' popups (the board menu, the "+N" list) is left to scroll it. Main thread.
 *
 * @param chromeRef - The floating chrome.
 * @param findCanvas - Finds the canvas the wheel goes to; none, and the wheel is left alone.
 */
export function useWheelToCanvas(
  chromeRef: RefObject<HTMLElement | null>,
  findCanvas: (chrome: HTMLElement) => HTMLCanvasElement | null,
): void {
  useEffect(() => {
    const chrome = chromeRef.current;
    if (chrome === null) return undefined;
    const onWheel = (event: WheelEvent): void => {
      if (event.target instanceof Element && event.target.closest(OWN_SCROLL_SELECTOR) !== null) {
        return;
      }
      const canvas = findCanvas(chrome);
      if (canvas === null) return;
      event.preventDefault();
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaZ: event.deltaZ,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
        }),
      );
    };
    chrome.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      chrome.removeEventListener('wheel', onWheel);
    };
  }, [chromeRef, findCanvas]);
}
