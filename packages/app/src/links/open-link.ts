import { normalizeLink } from '@canvas/schema';

/** Opens a URL in a new browsing context: `window.open`'s shape. */
export type LinkOpener = (url: string, target: string, features: string) => unknown;

/**
 * Opens an object's link in a new tab, with no opener and no referrer, so the page it
 * opens can neither reach back into the board nor learn its address. The link is checked again
 * here, at the moment of opening, though every stored link already passed `normalizeLink`: only
 * a link that rule leaves unchanged is opened, as it is, never decoded or joined to another URL.
 *
 * @param link - The stored link.
 * @param open - Opens it; `window.open` if absent.
 * @returns True when it was opened.
 */
export function openLink(
  link: string,
  open: LinkOpener = (url, target, features) => window.open(url, target, features),
): boolean {
  if (normalizeLink(link) !== link) return false;
  open(link, '_blank', 'noopener,noreferrer');
  return true;
}
