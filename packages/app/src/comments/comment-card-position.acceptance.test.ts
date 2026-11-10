// CONTRACT: a card avoids reserved chrome without changing its inputs or treating touching edges as overlap.
import { describe, expect, it } from 'vitest';

import { cardPlacement, CARD_GAP_PX, pinRect } from './comment-card-position.js';

const viewport = { width: 1000, height: 700 };
const insets = { top: 60, right: 10, bottom: 60, left: 10 };
const card = { width: 200, height: 150 };

describe('reserved-zone placement contract', () => {
  it('keeps the first side when a zone only touches the card edge', () => {
    const pin = pinRect({ x: 300, y: 300 });
    expect(
      cardPlacement({
        pin,
        card,
        viewport,
        insets,
        zones: [{ left: 536, top: 200, width: 40, height: 300 }],
      }),
    ).toEqual({ left: 336, top: 272, side: 'right' });
  });

  it('tries the left side when raising the blocked right side would cross the top inset', () => {
    const pin = pinRect({ x: 300, y: 220 });
    expect(
      cardPlacement({
        pin,
        card,
        viewport,
        insets,
        zones: [{ left: 400, top: 150, width: 100, height: 200 }],
      }),
    ).toEqual({ left: 92, top: 192, side: 'left' });
  });

  it('uses a clear left side when the right side is blocked through the full height', () => {
    const pin = pinRect({ x: 300, y: 300 });
    expect(
      cardPlacement({
        pin,
        card,
        viewport,
        insets,
        zones: [{ left: 400, top: 0, width: 100, height: 700 }],
      }),
    ).toEqual({ left: 92, top: 272, side: 'left' });
  });

  it('raises above the topmost zone met, leaving a full gap', () => {
    const pin = pinRect({ x: 300, y: 500 });
    const zones = [
      { left: 350, top: 480, width: 100, height: 100 },
      { left: 400, top: 400, width: 100, height: 100 },
    ];
    expect(cardPlacement({ pin, card, viewport, insets, zones })).toEqual({
      left: 336,
      top: 400 - CARD_GAP_PX - card.height,
      side: 'right',
    });
  });

  it('leaves every nested input and the zone array untouched', () => {
    const pin = Object.freeze(pinRect({ x: 300, y: 500 }));
    const zone = Object.freeze({ left: 350, top: 400, width: 100, height: 200 });
    const zones = Object.freeze([zone]);
    const input = Object.freeze({
      pin,
      card: Object.freeze({ ...card }),
      viewport: Object.freeze({ ...viewport }),
      insets: Object.freeze({ ...insets }),
      zones,
    });
    expect(() => cardPlacement(input)).not.toThrow();
    expect(input.zones).toEqual([zone]);
    expect(input.pin).toEqual(pinRect({ x: 300, y: 500 }));
  });
});
