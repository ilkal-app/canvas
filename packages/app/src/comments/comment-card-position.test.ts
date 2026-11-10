import { describe, expect, it } from 'vitest';

import { cardPlacement, CARD_GAP_PX, pinRect, PIN_SIZE_PX } from './comment-card-position.js';

const VIEWPORT = { width: 1280, height: 800 };
const INSETS = { top: 74, right: 12, bottom: 78, left: 12 };
const CARD = { width: 288, height: 180 };

describe('pinRect', () => {
  it('anchors the pin at its bottom-left corner', () => {
    expect(pinRect({ x: 100, y: 200 })).toEqual({
      left: 100,
      top: 200 - PIN_SIZE_PX,
      width: PIN_SIZE_PX,
      height: PIN_SIZE_PX,
    });
  });
});

describe('cardPlacement', () => {
  it('opens to the right of the pin, top-aligned with it, 8 px away', () => {
    const pin = pinRect({ x: 400, y: 300 });
    expect(cardPlacement({ pin, card: CARD, viewport: VIEWPORT, insets: INSETS })).toEqual({
      left: 400 + PIN_SIZE_PX + CARD_GAP_PX,
      top: 300 - PIN_SIZE_PX,
      side: 'right',
    });
  });

  it('flips to the left near the right edge', () => {
    const pin = pinRect({ x: 1100, y: 300 });
    expect(cardPlacement({ pin, card: CARD, viewport: VIEWPORT, insets: INSETS })).toEqual({
      left: 1100 - CARD_GAP_PX - CARD.width,
      top: 300 - PIN_SIZE_PX,
      side: 'left',
    });
  });

  it('stays below the top bars and above the dock', () => {
    const high = cardPlacement({
      pin: pinRect({ x: 400, y: 40 }),
      card: CARD,
      viewport: VIEWPORT,
      insets: INSETS,
    });
    expect(high.top).toBe(INSETS.top);
    const low = cardPlacement({
      pin: pinRect({ x: 400, y: 790 }),
      card: CARD,
      viewport: VIEWPORT,
      insets: INSETS,
    });
    expect(low.top).toBe(VIEWPORT.height - INSETS.bottom - CARD.height);
  });

  it('opens below the pin when it fits on neither side (a phone), held inside the sides', () => {
    const phone = { width: 390, height: 844 };
    const pin = pinRect({ x: 180, y: 400 });
    expect(
      cardPlacement({ pin, card: { width: 288, height: 180 }, viewport: phone, insets: INSETS }),
    ).toEqual({ left: 390 - INSETS.right - 288, top: 400 + CARD_GAP_PX, side: 'below' });
    expect(
      cardPlacement({
        pin: pinRect({ x: 60, y: 400 }),
        card: { width: 288, height: 180 },
        viewport: phone,
        insets: INSETS,
      }),
    ).toEqual({ left: 60, top: 400 + CARD_GAP_PX, side: 'below' });
  });

  it('opens above the pin when there is no room below it', () => {
    const phone = { width: 390, height: 844 };
    const pin = pinRect({ x: 180, y: 700 });
    expect(
      cardPlacement({ pin, card: { width: 288, height: 180 }, viewport: phone, insets: INSETS }),
    ).toEqual({
      left: 390 - INSETS.right - 288,
      top: 700 - PIN_SIZE_PX - CARD_GAP_PX - 180,
      side: 'above',
    });
  });

  it('keeps a card that fits nowhere beside the pin inside the viewport', () => {
    const phone = { width: 390, height: 500 };
    const placement = cardPlacement({
      pin: pinRect({ x: 180, y: 300 }),
      card: { width: 366, height: 300 },
      viewport: phone,
      insets: INSETS,
    });
    expect(placement.left).toBe(INSETS.left);
    expect(placement.top).toBe(500 - INSETS.bottom - 300);
  });

  it('pins a card taller than the room under the top bars', () => {
    const placement = cardPlacement({
      pin: pinRect({ x: 400, y: 300 }),
      card: { width: 288, height: 2000 },
      viewport: VIEWPORT,
      insets: INSETS,
    });
    expect(placement.top).toBe(INSETS.top);
  });

  it('does not mutate its input', () => {
    const input = Object.freeze({
      pin: Object.freeze(pinRect({ x: 1100, y: 300 })),
      card: Object.freeze({ ...CARD }),
      viewport: Object.freeze({ ...VIEWPORT }),
      insets: Object.freeze({ ...INSETS }),
    });
    expect(() => cardPlacement(input)).not.toThrow();
  });
});

describe('cardPlacement clear of the floating chrome', () => {
  // The floating Facilitate card at the bottom right, and the dock at the bottom centre.
  const facilitate = { left: 1016, top: 520, width: 248, height: 264 };
  const dock = { left: 400, top: 734, width: 480, height: 50 };

  it('places as before where no zone is met', () => {
    const pin = pinRect({ x: 400, y: 300 });
    const input = { pin, card: CARD, viewport: VIEWPORT, insets: INSETS };
    expect(cardPlacement({ ...input, zones: [facilitate, dock] })).toEqual(cardPlacement(input));
  });

  it('moves the card up on its side to end a gap above a zone it meets', () => {
    const pin = pinRect({ x: 800, y: 620 });
    expect(
      cardPlacement({ pin, card: CARD, viewport: VIEWPORT, insets: INSETS, zones: [facilitate] }),
    ).toEqual({
      left: 800 + PIN_SIZE_PX + CARD_GAP_PX,
      top: 520 - CARD_GAP_PX - CARD.height,
      side: 'right',
    });
  });

  it('takes the other side when one side cannot clear a zone', () => {
    // A zone filling the right of the pin top to bottom: the card opens on the left.
    const wall = { left: 700, top: 0, width: 100, height: 800 };
    const pin = pinRect({ x: 660, y: 300 });
    expect(
      cardPlacement({ pin, card: CARD, viewport: VIEWPORT, insets: INSETS, zones: [wall] }),
    ).toEqual({ left: 660 - CARD_GAP_PX - CARD.width, top: 300 - PIN_SIZE_PX, side: 'left' });
  });

  it('goes below the pin when both sides meet zones it cannot clear', () => {
    // Zones beside the pin down to just below its top: neither side can move up past them.
    const left = { left: 0, top: 0, width: 640, height: 200 };
    const right = { left: 690, top: 0, width: 590, height: 200 };
    const pin = pinRect({ x: 650, y: 200 });
    expect(
      cardPlacement({ pin, card: CARD, viewport: VIEWPORT, insets: INSETS, zones: [left, right] }),
    ).toEqual({ left: 650, top: 200 + CARD_GAP_PX, side: 'below' });
  });

  it('keeps the placement beside the pin where no side is clear', () => {
    const everywhere = { left: 0, top: 0, width: 1280, height: 800 };
    const pin = pinRect({ x: 400, y: 300 });
    const input = { pin, card: CARD, viewport: VIEWPORT, insets: INSETS };
    expect(cardPlacement({ ...input, zones: [everywhere] })).toEqual(cardPlacement(input));
  });
});
