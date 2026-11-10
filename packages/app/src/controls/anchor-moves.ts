/** The window event that says an element some popups open from has moved (item 3). */
const ANCHORS_MOVED_EVENT = 'canvas:anchors-moved';

/**
 * Says that elements popups open from have moved without the window changing: the selection's
 * popover following the camera (item 3), so its open menus follow their buttons. Main
 * thread; nothing listens unless a popup anchored to an element is open.
 */
export function announceAnchorsMoved(): void {
  window.dispatchEvent(new Event(ANCHORS_MOVED_EVENT));
}

/**
 * Listens for {@link announceAnchorsMoved}.
 *
 * @param listener - Called after each announcement.
 * @returns A function that stops listening.
 */
export function onAnchorsMoved(listener: () => void): () => void {
  window.addEventListener(ANCHORS_MOVED_EVENT, listener);
  return () => {
    window.removeEventListener(ANCHORS_MOVED_EVENT, listener);
  };
}
