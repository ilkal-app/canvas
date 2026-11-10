import { useEffect, type RefObject } from 'react';

import { openLink } from './open-link.js';

/** How far a ⌘-click may move between press and release and still be a click, CSS px. */
const CLICK_SLOP_PX = 4;

/** What a ⌘-click must be, beyond its button, modifier and distance. */
export interface LinkClickGate {
  /**
   * Whether a pointer event is the person's own primary input: trusted (not dispatched by a
   * script) and the primary pointer. `event.isTrusted && event.isPrimary` if absent.
   */
  readonly isGenuine?: ((event: PointerEvent) => boolean) | undefined;
  /**
   * Whether a release is still over the canvas (no control or overlay drawn over the point).
   * `document.elementFromPoint` is the canvas if absent.
   */
  readonly isOver?: ((event: PointerEvent, element: HTMLElement) => boolean) | undefined;
}

/**
 * Whether an event is trusted, primary input.
 *
 * @param event - The event.
 * @returns True for the person's own primary pointer.
 */
function isTrustedPrimary(event: PointerEvent): boolean {
  return event.isTrusted && event.isPrimary;
}

/**
 * Whether the page draws the canvas itself at the release point.
 *
 * @param event - The release.
 * @param element - The canvas.
 * @returns True when nothing is over the canvas there.
 */
function isOverElement(event: PointerEvent, element: HTMLElement): boolean {
  return document.elementFromPoint(event.clientX, event.clientY) === element;
}

/**
 * Opens an object's link on ⌘-click (Ctrl-click off a Mac) on the canvas: the
 * person's own primary press with the modifier on the canvas element itself (not a control or
 * overlay above it), released within {@link CLICK_SLOP_PX} still over the canvas, over an object
 * whose link `linkAt` finds. A drag, a script's synthetic events, a second pointer, a press
 * another layer cancelled (an armed reaction's drop) or a click on no link does nothing here
 * (the select tool still sees every press); a plain click opens nothing, and is only told to
 * `onPlainClick`. Main thread.
 *
 * @param target - The canvas.
 * @param linkAt - The link under a page point, if any.
 * @param open - Opens a link; {@link openLink} if absent.
 * @param gate - What counts as the person's click; trusted primary input over the canvas if
 *   absent.
 * @param onPlainClick - Told of the same click without the modifier (a click or a tap
 *   that shows the link chip), past the same gate; it opens nothing. None if absent.
 */
export function useLinkClicks(
  target: RefObject<HTMLElement | null>,
  linkAt: ((clientX: number, clientY: number) => string | undefined) | undefined,
  open: (link: string) => boolean = openLink,
  gate: LinkClickGate = {},
  onPlainClick?: (release: PointerEvent) => void,
): void {
  const isGenuine = gate.isGenuine ?? isTrustedPrimary;
  const isOver = gate.isOver ?? isOverElement;
  useEffect(() => {
    const element = target.current;
    if (element === null || linkAt === undefined) return undefined;
    let press:
      | {
          readonly x: number;
          readonly y: number;
          readonly id: number;
          readonly down: PointerEvent;
          readonly isModified: boolean;
        }
      | undefined;
    const onDown = (event: PointerEvent): void => {
      const isModified = event.metaKey || event.ctrlKey;
      const isStart =
        (isModified || onPlainClick !== undefined) &&
        event.button === 0 &&
        event.target === element &&
        isGenuine(event);
      press = isStart
        ? { x: event.clientX, y: event.clientY, id: event.pointerId, down: event, isModified }
        : undefined;
    };
    const onUp = (event: PointerEvent): void => {
      const started = press;
      press = undefined;
      if (event.pointerId !== started?.id || event.buttons !== 0 || !isGenuine(event)) return;
      const moved = Math.hypot(event.clientX - started.x, event.clientY - started.y);
      if (moved > CLICK_SLOP_PX || !isOver(event, element)) return;
      // A press another layer took (an armed reaction drops there) opens nothing: its
      // handler cancels the press, which the event keeps whichever listener ran first.
      if (started.down.defaultPrevented) return;
      if (!started.isModified) {
        onPlainClick?.(event);
        return;
      }
      const link = linkAt(event.clientX, event.clientY);
      if (link !== undefined) open(link);
    };
    element.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    return () => {
      element.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
    };
  }, [target, linkAt, open, isGenuine, isOver, onPlainClick]);
}
