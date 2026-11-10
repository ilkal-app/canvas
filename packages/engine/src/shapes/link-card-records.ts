import type { LinkObject, Rgba } from '@canvas/schema';

import type { ColorPalette } from '../paint/color-palette.js';
import type { WorldTransform } from '../scene/world-transform.js';

import {
  hasLinkFavicon,
  LINK_CARD_LOOK,
  linkCardParts,
  linkPreviewBox,
  type CardBox,
} from './link-card-geometry.js';

// A link card's shapes in the SDF shape pass: its soft shadow, its paper with a
// hairline, the preview's area (rounded at the card's corners only: a rounded box and a square
// one over its inner half), the bars a pending card shows where its text will go, and the site
// icon's stand-in. The preview image, the icon and the text draw over them in later passes.

/** One record of a card: where it goes, its look, and its outline. */
interface CardRecord {
  /** Its box in the card's frame. */
  readonly box: CardBox;
  /** Its fill. */
  readonly fill: Rgba;
  /** Its corner radius. */
  readonly radius: number;
  /** Its edge's blur half-width; 0 for a crisp edge. */
  readonly softness?: number;
  /** Its hairline, drawn inside its edge; none when absent. */
  readonly outline?: { readonly color: Rgba; readonly width: number };
}

/** The shadow under a card: black at 10%, a little lower than the card, blurred. */
const CARD_SHADOW = Object.freeze({
  color: [0, 0, 0, 0.1] as Rgba,
  offsetTop: 4,
  inset: 2,
  softness: 8,
});

/**
 * A colour between two others, opaque: `share` of the way from `from` to `to`.
 *
 * @param from - The first colour.
 * @param to - The second.
 * @param share - How far, 0 to 1.
 * @returns The mixed colour.
 */
function mix(from: Rgba, to: Rgba, share: number): Rgba {
  return [
    from[0] + (to[0] - from[0]) * share,
    from[1] + (to[1] - from[1]) * share,
    from[2] + (to[2] - from[2]) * share,
    1,
  ];
}

/**
 * The preview's area as two records: a rounded box, and a square box over its inner half, so
 * only the corners at the card's edge are round.
 *
 * @param image - The area.
 * @param isHorizontal - Whether it is a horizontal card's (rounded on the left).
 * @param fill - Its colour.
 * @returns The two records.
 */
function imageAreaRecords(image: CardBox, isHorizontal: boolean, fill: Rgba): CardRecord[] {
  const radius = LINK_CARD_LOOK.radius - 1;
  const inner = isHorizontal
    ? { ...image, x: image.x + image.width / 2, width: image.width / 2 }
    : { ...image, y: image.y + image.height / 2, height: image.height / 2 };
  return [
    { box: image, fill, radius },
    { box: inner, fill, radius: 0 },
  ];
}

/**
 * A card's records in paint order: shadow, paper, the preview's area (not on a failed
 * card), a pending card's two text bars, then the site icon's stand-in when the icon does not
 * draw (none on a failed card). Pure.
 *
 * @param card - The card.
 * @param palette - What its colour tokens draw as.
 * @returns The records.
 */
export function linkCardRecords(card: LinkObject, palette: ColorPalette): CardRecord[] {
  const parts = linkCardParts(card);
  const surface = palette.tokenColor('surface');
  const border = palette.tokenColor('border');
  const { width, height } = card;
  const records: CardRecord[] = [
    {
      box: {
        x: CARD_SHADOW.inset,
        y: CARD_SHADOW.offsetTop,
        width: width - 2 * CARD_SHADOW.inset,
        height,
      },
      fill: CARD_SHADOW.color,
      radius: LINK_CARD_LOOK.radius,
      softness: CARD_SHADOW.softness,
    },
    {
      box: { x: 0, y: 0, width, height },
      fill: surface,
      radius: LINK_CARD_LOOK.radius,
      outline: { color: border, width: 1 },
    },
  ];
  const image = linkPreviewBox(card);
  if (image !== undefined) {
    // The preview's placeholder, under the image while it loads or where the page has none.
    records.push(
      ...imageAreaRecords(image, card.layout === 'horizontal', mix(surface, border, 0.35)),
    );
  }
  if (card.status === 'pending') {
    const bar = mix(surface, border, 0.55);
    const { title } = parts;
    const lineHeight = LINK_CARD_LOOK.titleLineHeight;
    records.push(
      {
        box: { x: title.x, y: title.y + 3, width: title.width * 0.85, height: 12 },
        fill: bar,
        radius: 6,
      },
      {
        box: { x: title.x, y: title.y + 3 + lineHeight, width: title.width * 0.6, height: 10 },
        fill: bar,
        radius: 5,
      },
    );
  }
  // A failed card shows no icon (frame L3): its footer says there is no preview.
  if (card.status !== 'failed' && !hasLinkFavicon(card)) {
    records.push({ box: parts.icon, fill: palette.tokenColor('accent'), radius: 2 });
  }
  return records;
}

/**
 * How many records a card draws in the shape pass (`linkCardRecords`): shadow and paper, two for
 * the preview's area (not on a failed card), two text bars on a pending card, and the icon's
 * stand-in where the site's icon does not draw, but on a failed card. Pure.
 *
 * @param card - The card.
 * @returns The count.
 */
export function linkCardRecordCount(card: LinkObject): number {
  const imageRecords = card.status === 'failed' ? 0 : 2;
  const barRecords = card.status === 'pending' ? 2 : 0;
  const iconRecords = card.status === 'failed' || hasLinkFavicon(card) ? 0 : 1;
  return 2 + imageRecords + barRecords + iconRecords;
}

/**
 * Where one record of a card is placed in the world (its box's corner in the card's frame,
 * turned with the card), as the shape pass's move placement reads it: the same arithmetic as
 * `writeLinkCardRecord`.
 *
 * @param card - The card.
 * @param transform - The card's frame to the world.
 * @param palette - What its colour tokens draw as.
 * @param index - Which of its records.
 * @returns The record's placement.
 */
export function linkCardRecordPlacement(
  card: LinkObject,
  transform: WorldTransform,
  palette: ColorPalette,
  index: number,
): WorldTransform {
  const box = linkCardRecords(card, palette)[index]?.box;
  if (box === undefined) return transform;
  const { cos, sin } = transform;
  return {
    x: transform.x + cos * box.x - sin * box.y,
    y: transform.y + sin * box.x + cos * box.y,
    cos,
    sin,
  };
}

/**
 * Writes one record of a card into the shape pass's record (`SHAPE_INSTANCE_FLOATS`): its box
 * in the card's frame placed by the card's transform, its fill, radius, softness and hairline.
 * Allocates for the card's records; a card changes rarely.
 *
 * @param record - The record, zero-filled.
 * @param card - The card.
 * @param transform - The card's frame to the world.
 * @param palette - What its colour tokens draw as.
 * @param index - Which of its records.
 */
export function writeLinkCardRecord(
  record: Float32Array,
  card: LinkObject,
  transform: WorldTransform,
  palette: ColorPalette,
  index: number,
): void {
  const part = linkCardRecords(card, palette)[index];
  if (part === undefined) return;
  const { cos, sin } = transform;
  const { box } = part;
  record[0] = transform.x + cos * box.x - sin * box.y;
  record[1] = transform.y + sin * box.x + cos * box.y;
  record[2] = box.width;
  record[3] = box.height;
  record[4] = part.fill[0];
  record[5] = part.fill[1];
  record[6] = part.fill[2];
  record[7] = part.fill[3];
  record[8] = part.radius;
  record[9] = part.softness ?? 0;
  // Float 10, the kind, stays 0: a rounded box.
  record[11] = cos;
  record[12] = sin;
  if (part.outline !== undefined) {
    record[13] = part.outline.color[0];
    record[14] = part.outline.color[1];
    record[15] = part.outline.color[2];
    record[16] = part.outline.color[3];
    record[17] = part.outline.width;
    // Float 19, the outline's share outside the edge, stays 0: inside the card.
  }
}
