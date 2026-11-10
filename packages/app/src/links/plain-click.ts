import type { MouseEvent } from 'react';

/**
 * Whether a click should open a link in the page: the primary button with no modifier (the
 * others open a tab or a window, as the browser does with any link).
 *
 * @param event - The click.
 * @returns Whether to handle it.
 */
export function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
