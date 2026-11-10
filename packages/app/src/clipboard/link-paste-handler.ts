import { LINK_CARD_SIZES, type NewObject } from '@canvas/document';
import { normalizeLink, type ObjectId, type Point } from '@canvas/schema';

import { detectKeyboardPlatform } from '../shortcuts/keyboard-platform.js';

import type { PasteHandler, PasteTarget } from './paste-handlers.js';

/**
 * Where the link handler sits among the paste handlers: above HTML (100), so a link
 * copied from a browser's address bar, which may come with HTML too, becomes a card; below the
 * canvas's own objects, the editor's runs and image files.
 */
export const LINK_PASTE_PRIORITY = 150;

/**
 * What a link pasted as a card says (frame L1's toast), with the platform's plain-paste
 * chord where there is a keyboard to press it.
 *
 * @param keyboard - The keyboard: a Mac's, another, or none (a touch screen).
 * @returns The notice.
 */
export function pastedLinkNotice(keyboard: 'mac' | 'other' | 'none'): string {
  if (keyboard === 'none') return 'Pasted as a link card';
  // Chrome on a Mac pastes plain text on ⌥⇧⌘V; ⇧⌘V fires no paste there.
  return `Pasted as a link card · Paste as text ${keyboard === 'mac' ? '⌥⇧⌘V' : 'Ctrl+Shift+V'}`;
}

/**
 * The keyboard this page is used with: none where the main pointer is a finger.
 *
 * @returns The keyboard.
 */
function keyboardOf(): 'mac' | 'other' | 'none' {
  // A test outside a page has no media queries.
  if ('matchMedia' in globalThis && globalThis.matchMedia('(pointer: coarse)').matches) {
    return 'none';
  }
  return detectKeyboardPlatform(navigator.userAgent);
}

/**
 * The link a pasted text is, when it is a lone web link: one http(s) URL and nothing else around
 * it but white space, as `normalizeLink` stores it. Pure.
 *
 * @param text - The pasted text.
 * @returns The link, or undefined for any other text.
 */
export function loneWebLinkOf(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === '' || /\s/u.test(trimmed)) return undefined;
  const link = normalizeLink(trimmed);
  return link?.startsWith('https:') === true || link?.startsWith('http:') === true
    ? link
    : undefined;
}

/**
 * A fresh key naming one fetch of a card's page.
 *
 * @returns The key.
 */
function freshUnfurlKey(): string {
  return `paste-${globalThis.crypto.randomUUID()}`;
}

/**
 * A pending link card for a pasted link, centred on a point.
 *
 * @param url - The link.
 * @param at - The paste point, world units.
 * @param unfurlKey - The key of its one fetch.
 * @returns The card, as `createObjects` lists it.
 */
export function newLinkCard(url: string, at: Point, unfurlKey: string): NewObject {
  const { width, height } = LINK_CARD_SIZES.vertical;
  return {
    type: 'link',
    x: at.x - width / 2,
    y: at.y - height / 2,
    rotation: 0,
    locked: false,
    parentId: null,
    width,
    height,
    url,
    title: '',
    description: '',
    siteName: '',
    layout: 'vertical',
    status: 'pending',
    unfurlKey,
  };
}

/**
 * Fetches a pasted card's page and writes what it gave: its preview, or failure where
 * the page could not be had or the page has no assets service.
 *
 * @param target - The paste's target.
 * @param id - The card.
 * @param url - The link.
 * @param unfurlKey - The card's key.
 */
async function unfurlPastedCard(
  target: PasteTarget,
  id: ObjectId,
  url: string,
  unfurlKey: string,
): Promise<void> {
  const preview = await target.unfurlLink?.(url).catch(() => undefined);
  target.applyLinkUnfurl?.(id, {
    unfurlKey,
    outcome: preview === undefined ? { status: 'failed' } : { status: 'ready', ...preview },
  });
}

/**
 * Fetches a failed card's page again (its Retry): the card goes back to pending under a
 * new key, then this client fetches the page and writes the preview, or failure, as a paste does.
 *
 * @param target - Where the board is written: the page's paste target.
 * @param id - The card.
 * @param url - Its link.
 * @returns Whether the card went back to pending.
 */
export function retryLinkCard(target: PasteTarget, id: ObjectId, url: string): boolean {
  const unfurlKey = freshUnfurlKey();
  if (target.retryLinkUnfurl?.(id, unfurlKey) !== true) return false;
  void unfurlPastedCard(target, id, url, unfurlKey);
  return true;
}

/**
 * Pastes a lone web link as a link card (a pasted URL becomes a
 * card by default): a pending card centred on the pointer, else the view's centre, in one undo
 * step; then this client fetches the page through the assets service and writes the preview
 * into the card, or marks it failed. Plain text (Mod+Shift+V), any other text, and a paste
 * into a text being edited (the editor's own paste) are left to the other handlers.
 *
 * @param item - The `text/plain` item.
 * @param target - Where the paste goes.
 * @returns Whether it made a card.
 */
export const pasteLinkCard: PasteHandler = (item, target) => {
  if (item.kind !== 'string' || target.isPlainText === true) return false;
  const url = loneWebLinkOf(item.data);
  if (url === undefined) return false;
  const unfurlKey = freshUnfurlKey();
  const card = newLinkCard(url, target.pointer ?? target.viewCentre, unfurlKey);
  return target.createObjects([card], ([id]) => {
    if (id === undefined) return;
    target.notify(pastedLinkNotice(keyboardOf()));
    void unfurlPastedCard(target, id, url, unfurlKey);
  });
};
