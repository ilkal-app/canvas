import { bench, describe } from 'vitest';

import { cardPlacement, pinRect } from './comment-card-position.js';

const VIEWPORT = { width: 1280, height: 800 };
const INSETS = { top: 74, right: 12, bottom: 78, left: 12 };
const CARD = { width: 288, height: 180 };

// The open card is placed again on every frame the camera moves.
describe('comment card placement', () => {
  bench('place a card beside its pin, flipping at the edge', () => {
    for (let x = 0; x < 1280; x += 16) {
      cardPlacement({
        pin: pinRect({ x, y: 400 }),
        card: CARD,
        viewport: VIEWPORT,
        insets: INSETS,
      });
    }
  });
});
