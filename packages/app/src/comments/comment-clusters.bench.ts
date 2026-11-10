import { bench, describe } from 'vitest';

import { clusterPins } from './comment-clusters.js';

/** 500 threads, on a 25 × 20 grid 40 px apart: none overlap at this zoom. */
const APART = [...Array.from({ length: 500 }).keys()].map((index) => ({
  id: String(index),
  x: (index % 25) * 40,
  y: Math.floor(index / 25) * 40,
}));

/** The same threads zoomed out to a tenth: most overlap. */
const ZOOMED_OUT = APART.map((pin) => ({ ...pin, x: pin.x / 10, y: pin.y / 10 }));

// The pins are grouped again on every frame the camera moves.
describe('comment pin clusters, 500 threads', () => {
  bench('group pins that do not overlap', () => {
    clusterPins(APART);
  });
  bench('group pins zoomed out', () => {
    clusterPins(ZOOMED_OUT);
  });
});
