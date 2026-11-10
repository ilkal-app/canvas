import type { LinkLayout, LinkObject, LinkStatus } from '@canvas/schema';

// A link card's parts in its own frame (the design board's frames L1–L3): the preview
// image's area, the text column with the title, the description and the footer (the site's icon
// and its domain), each a box from the card's top-left corner, in world units. Pure.

/** The card's look: corner radius, padding, gaps and type sizes, as the frames draw them. */
export const LINK_CARD_LOOK = Object.freeze({
  /** The card's corner radius. */
  radius: 10,
  /** The text column's padding. */
  padding: 12,
  /** The gap between the title, the description and the footer. */
  gap: 6,
  /** The preview's height in a vertical card, at most. */
  imageHeight: 168,
  /** The preview's share of a vertical card's height, at most. */
  imageShare: 0.6,
  /** The preview's width in a horizontal card, at most. */
  imageWidth: 92,
  /** The title's font size. */
  titleSize: 14,
  /** The title's line height. */
  titleLineHeight: 18,
  /** The description's font size. */
  descriptionSize: 12,
  /** The description's line height. */
  descriptionLineHeight: 16,
  /** The footer's font size, the domain's. */
  footerSize: 11,
  /** The footer's line height. */
  footerLineHeight: 14,
  /** The site icon's side. */
  iconSize: 10,
  /** The gap between the icon and the domain. */
  iconGap: 6,
});

/**
 * The built-in colour tokens a card draws with: its paper, hairline, text, muted text and
 * the site icon's stand-in, so a theme switch or a token edit redraws it.
 */
export const LINK_CARD_TOKENS: readonly string[] = Object.freeze([
  'surface',
  'border',
  'text',
  'muted',
  'accent',
]);

/** A box in the card's frame: its top-left corner and size, world units. */
export interface CardBox {
  /** Its left edge. */
  readonly x: number;
  /** Its top edge. */
  readonly y: number;
  /** Its width. */
  readonly width: number;
  /** Its height. */
  readonly height: number;
}

/** A link card's parts in its own frame. */
export interface LinkCardParts {
  /** The preview image's area, against the card's edges; absent on a failed card. */
  readonly image?: CardBox;
  /** The text column, inside its padding. */
  readonly column: CardBox;
  /** The title's box: at most two lines. */
  readonly title: CardBox;
  /** The description's box: at most two lines; absent on a failed card. */
  readonly description?: CardBox;
  /** The site icon's square. */
  readonly icon: CardBox;
  /** The domain's box, one line beside the icon. */
  readonly domain: CardBox;
}

/** What the card's parts depend on. */
export interface LinkCardShape {
  /** The card's width. */
  readonly width: number;
  /** Its height. */
  readonly height: number;
  /** Its layout. */
  readonly layout: LinkLayout;
  /** Its status: a failed card has no preview area and no description. */
  readonly status: LinkStatus;
}

/**
 * The preview area of a card and the text column beside or below it.
 *
 * @param card - The card.
 * @returns The image area, if any, and the column's outer box.
 */
function splitCard(card: LinkCardShape): { image?: CardBox; outer: CardBox } {
  const look = LINK_CARD_LOOK;
  const { width, height } = card;
  if (card.status === 'failed') return { outer: { x: 0, y: 0, width, height } };
  if (card.layout === 'horizontal') {
    const imageWidth = Math.min(look.imageWidth, width / 3);
    return {
      image: { x: 0, y: 0, width: imageWidth, height },
      outer: { x: imageWidth, y: 0, width: width - imageWidth, height },
    };
  }
  const imageHeight = Math.min(look.imageHeight, height * look.imageShare);
  return {
    image: { x: 0, y: 0, width, height: imageHeight },
    outer: { x: 0, y: imageHeight, width, height: height - imageHeight },
  };
}

/**
 * A link card's parts in its own frame: the preview's area (the top of a vertical card,
 * the left of a horizontal one, none on a failed one), then inside the padding the title (two
 * lines), the description (two lines) and the footer: the site's icon and its domain. A part
 * that would not fit is cut to the column. Pure.
 *
 * @param card - The card's size, layout and status.
 * @returns The parts.
 */
export function linkCardParts(card: LinkCardShape): LinkCardParts {
  const look = LINK_CARD_LOOK;
  const { image, outer } = splitCard(card);
  const column: CardBox = {
    x: outer.x + look.padding,
    y: outer.y + look.padding,
    width: Math.max(0, outer.width - 2 * look.padding),
    height: Math.max(0, outer.height - 2 * look.padding),
  };
  const bottom = column.y + column.height;
  const titleHeight = 2 * look.titleLineHeight;
  const title = { ...column, height: Math.min(titleHeight, column.height) };
  const footerTop = Math.max(column.y, bottom - look.footerLineHeight);
  const iconTop = footerTop + (look.footerLineHeight - look.iconSize) / 2;
  const icon = { x: column.x, y: iconTop, width: look.iconSize, height: look.iconSize };
  const domainLeft = column.x + look.iconSize + look.iconGap;
  const domain = {
    x: domainLeft,
    y: footerTop,
    width: Math.max(0, column.x + column.width - domainLeft),
    height: look.footerLineHeight,
  };
  const descriptionTop = title.y + title.height + look.gap;
  const descriptionRoom = footerTop - look.gap - descriptionTop;
  const descriptionHeight = Math.min(2 * look.descriptionLineHeight, Math.max(0, descriptionRoom));
  const description =
    card.status === 'failed'
      ? undefined
      : { x: column.x, y: descriptionTop, width: column.width, height: descriptionHeight };
  return {
    ...(image === undefined ? {} : { image }),
    column,
    title,
    ...(description === undefined ? {} : { description }),
    icon,
    domain,
  };
}

/**
 * Where a card's preview image draws: its area inside the card's 1-unit hairline, so
 * the outline stays whole over it; undefined on a failed card. Pure.
 *
 * @param card - The card's size, layout and status.
 * @returns The box, or undefined.
 */
export function linkPreviewBox(card: LinkCardShape): CardBox | undefined {
  const area = linkCardParts(card).image;
  if (area === undefined) return undefined;
  const isHorizontal = card.layout === 'horizontal';
  return {
    x: area.x + 1,
    y: area.y + 1,
    width: area.width - (isHorizontal ? 1 : 2),
    height: area.height - (isHorizontal ? 2 : 1),
  };
}

/**
 * Whether a card draws its site's icon: it has the icon's asset and size. Otherwise
 * the footer shows a stand-in square in the accent colour. Pure.
 *
 * @param card - The card.
 * @returns True when the icon draws.
 */
export function hasLinkFavicon(card: LinkObject): boolean {
  return card.faviconAssetId !== undefined && card.faviconSize !== undefined;
}

/**
 * The domain a card shows: its URL's host without `www.`, else the URL.
 *
 * @param url - The card's URL.
 * @returns The domain.
 */
export function linkDomainOf(url: string): string {
  if (!URL.canParse(url)) return url;
  const host = new URL(url).hostname;
  return host.startsWith('www.') ? host.slice(4) : host;
}
