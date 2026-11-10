// CONTRACT: floating cards keep the 12 px pin gap on every placement and clamp their 8 px lift below top chrome.
import { expect, it } from 'vitest';

import { cardPlacement, pinRect, WHITEBOARD_CARD_SPACING } from './comment-card-position.js';

const card = { width: 288, height: 180 };
const insets = { top: 74, right: 12, bottom: 78, left: 12 };

it('clamps a lifted side card to the top inset', () => {
  const pin = pinRect({ x: 400, y: 90 });
  expect(
    cardPlacement({
      pin,
      card,
      viewport: { width: 1280, height: 800 },
      insets,
      spacing: WHITEBOARD_CARD_SPACING,
    }),
  ).toEqual({ left: pin.left + pin.width + 12, top: 74, side: 'right' });
});

it('keeps 12 px when flipping left', () => {
  const pin = pinRect({ x: 780, y: 300 });
  const result = cardPlacement({
    pin,
    card,
    viewport: { width: 1000, height: 800 },
    insets,
    spacing: WHITEBOARD_CARD_SPACING,
  });
  expect(result).toEqual({ left: pin.left - 12 - card.width, top: pin.top - 8, side: 'left' });
  expect(pin.left - (result.left + card.width)).toBe(12);
});

it('keeps 12 px below a pin when neither side fits', () => {
  const pin = pinRect({ x: 160, y: 250 });
  const result = cardPlacement({
    pin,
    card,
    viewport: { width: 320, height: 700 },
    insets,
    spacing: WHITEBOARD_CARD_SPACING,
  });
  expect(result.side).toBe('below');
  expect(result.top - (pin.top + pin.height)).toBe(12);
});

it('keeps 12 px above a pin when neither side nor below fits', () => {
  const pin = pinRect({ x: 160, y: 500 });
  const result = cardPlacement({
    pin,
    card,
    viewport: { width: 320, height: 600 },
    insets,
    spacing: WHITEBOARD_CARD_SPACING,
  });
  expect(result.side).toBe('above');
  expect(pin.top - (result.top + card.height)).toBe(12);
});
