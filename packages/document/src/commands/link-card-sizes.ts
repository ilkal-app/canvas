import type { LinkLayout, LinkStatus } from '@canvas/schema';

/** A link card's size, world units. */
export interface LinkCardSize {
  /** Its width. */
  readonly width: number;
  /** Its height. */
  readonly height: number;
}

/** A link card's size in each layout, world units: the frames' card sizes. */
export const LINK_CARD_SIZES: Readonly<Record<LinkLayout, LinkCardSize>> = Object.freeze({
  vertical: Object.freeze({ width: 320, height: 280 }),
  horizontal: Object.freeze({ width: 440, height: 120 }),
});

/** A failed card's height (frame L3): its URL and "No preview available" alone. */
export const FAILED_LINK_CARD_HEIGHT = 72;

/**
 * The size a card takes in a layout and status: the layout's, or, failed, as wide and
 * compact. Pure.
 *
 * @param layout - The layout.
 * @param status - The status.
 * @returns The size.
 */
export function linkCardSizeOf(layout: LinkLayout, status: LinkStatus): LinkCardSize {
  const size = LINK_CARD_SIZES[layout];
  return status === 'failed' ? { width: size.width, height: FAILED_LINK_CARD_HEIGHT } : size;
}
