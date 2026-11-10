import type { BoardObject, LinkObject, StyleRun, TextStyle } from '@canvas/schema';
import { DEFAULT_FONT_FAMILY, LINE_HEIGHT_EM } from '@canvas/text';

import { LINK_CARD_LOOK, linkCardParts, linkDomainOf } from '../../shapes/link-card-geometry.js';

import type { TextBoxGeometry } from './text-placement.js';

// A link card's text (the design board's frames L1–L3): the title in bold over the
// description in the card's text column, each cut to two lines, and the site's domain in the
// footer beside its icon. A pending card shows bars instead; a failed one its URL without its
// scheme, and "No preview available" then "Retry" in the accent colour in its footer, set apart
// by space alone, as frame L3 draws them (no separator).

/** The title's style: the card's text colour, bold. */
const TITLE_STYLE: TextStyle = {
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: LINK_CARD_LOOK.titleSize,
  color: { token: 'text' },
  weight: 700,
  italic: false,
};

/** The description's style: muted. */
const DESCRIPTION_STYLE: TextStyle = {
  ...TITLE_STYLE,
  fontSize: LINK_CARD_LOOK.descriptionSize,
  color: { token: 'muted' },
  weight: 400,
};

/** The domain's style: muted, small. */
const DOMAIN_STYLE: TextStyle = { ...DESCRIPTION_STYLE, fontSize: LINK_CARD_LOOK.footerSize };

/** A failed card's Retry, in its footer: the accent colour, bold. */
const RETRY_STYLE: TextStyle = { ...DOMAIN_STYLE, color: { token: 'accent' }, weight: 700 };

/** What a failed card's footer says before its Retry (frame L3). */
const NO_PREVIEW = 'No preview available   ';

/**
 * A URL as a failed card shows it: without its scheme or a trailing slash.
 *
 * @param url - The URL.
 * @returns The shown text.
 */
function bareUrlOf(url: string): string {
  return url.replace(/^https?:\/\//u, '').replace(/\/$/u, '');
}

/** The most lines of the title and of the description. */
const BODY_LINE_CAPS: readonly number[] = Object.freeze([2, 2]);

/** One line: a failed card's URL, and the footer's domain. */
const ONE_LINE: readonly number[] = Object.freeze([1]);

/** Each card version's body and footer boxes: a card is an immutable value. */
const boxes = new WeakMap<LinkObject, { body?: TextBoxGeometry; footer?: TextBoxGeometry }>();

/**
 * The body a card shows: its title (or, without one, its URL) over its description; a failed
 * card's URL alone.
 *
 * @param card - The card.
 * @returns The text and its runs.
 */
function bodyOf(card: LinkObject): { text: string; runs: StyleRun[]; caps: readonly number[] } {
  if (card.status === 'failed') {
    const url = bareUrlOf(card.url);
    return { text: url, runs: [{ length: url.length, style: TITLE_STYLE }], caps: ONE_LINE };
  }
  const title = card.title === '' ? card.url : card.title;
  if (card.description === '') {
    return { text: title, runs: [{ length: title.length, style: TITLE_STYLE }], caps: ONE_LINE };
  }
  return {
    text: `${title}\n${card.description}`,
    runs: [
      { length: title.length + 1, style: TITLE_STYLE },
      { length: card.description.length, style: DESCRIPTION_STYLE },
    ],
    caps: BODY_LINE_CAPS,
  };
}

/**
 * Lays out a card's two boxes.
 *
 * @param card - The card.
 * @returns Its body and footer, none while pending.
 */
function boxesOf(card: LinkObject): { body?: TextBoxGeometry; footer?: TextBoxGeometry } {
  if (card.status === 'pending') return {};
  const parts = linkCardParts(card);
  const { text, runs, caps } = bodyOf(card);
  const body: TextBoxGeometry = {
    text,
    runs,
    wrapWidth: parts.column.width,
    align: 'left',
    direction: 'auto',
    verticalAlign: 'top',
    boxHeight: parts.column.height,
    origin: { x: parts.column.x, y: parts.column.y },
    lineCaps: caps,
  };
  const isFailed = card.status === 'failed';
  const domain = isFailed ? `${NO_PREVIEW}Retry` : linkDomainOf(card.url);
  // A failed card's footer has no icon: it starts at the column's edge.
  const left = isFailed ? parts.column.x : parts.domain.x;
  const footer: TextBoxGeometry = {
    text: domain,
    runs: isFailed
      ? [
          { length: NO_PREVIEW.length, style: DOMAIN_STYLE },
          { length: domain.length - NO_PREVIEW.length, style: RETRY_STYLE },
        ]
      : [{ length: domain.length, style: DOMAIN_STYLE }],
    wrapWidth: parts.column.x + parts.column.width - left,
    align: 'left',
    direction: 'auto',
    verticalAlign: 'top',
    boxHeight: parts.domain.height,
    // The line centred on the footer's line height, as the icon is.
    origin: {
      x: left,
      y: parts.domain.y + (parts.domain.height - DOMAIN_STYLE.fontSize * LINE_HEIGHT_EM) / 2,
    },
    lineCaps: ONE_LINE,
  };
  return { body, footer };
}

/**
 * The boxes of a card, kept per card version.
 *
 * @param object - The object.
 * @returns Its boxes; none for an object that is not a link card.
 */
function cardBoxesOf(object: BoardObject): { body?: TextBoxGeometry; footer?: TextBoxGeometry } {
  if (object.type !== 'link') return {};
  let found = boxes.get(object);
  if (found === undefined) {
    found = boxesOf(object);
    boxes.set(object, found);
  }
  return found;
}

/**
 * Where a link card's title and description lay out: the text column, wrapping at its
 * width, each paragraph cut to two lines (`lineCaps`); a failed card's URL on one line. Pure.
 *
 * @param object - The object.
 * @returns The box, or undefined for a pending card or an object that is not a card.
 */
export function linkCardBodyPlacement(object: BoardObject): TextBoxGeometry | undefined {
  return cardBoxesOf(object).body;
}

/**
 * Where a link card's domain lays out: one line in the footer, beside the icon. Pure.
 *
 * @param object - The object.
 * @returns The box, or undefined for a pending card or an object that is not a card.
 */
export function linkCardFooterPlacement(object: BoardObject): TextBoxGeometry | undefined {
  return cardBoxesOf(object).footer;
}
