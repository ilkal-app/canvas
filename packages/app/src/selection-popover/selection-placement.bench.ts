import { bench, describe } from 'vitest';

import { followSelectionPopover } from './selection-placement.js';

const VIEWPORT = { x: 0, y: 0, width: 1440, height: 900 };
const SIZE = { width: 370, height: 40 };

/** The floating chrome's reserved zones: board bar, presence, dock, zoom control. */
const RESERVED = [
  { x: 16, y: 16, width: 320, height: 48 },
  { x: 1100, y: 16, width: 324, height: 48 },
  { x: 470, y: 836, width: 500, height: 48 },
  { x: 1300, y: 836, width: 124, height: 48 },
];

/** A pan's selections: 200 frames sweeping across the viewport. */
const FRAMES = [...Array.from({ length: 200 }).keys()].map((index) => ({
  x: index * 7,
  y: 300 + index,
  width: 160,
  height: 120,
}));

// The popover follows the selection on every camera frame (item 4); camera-only frames
// stay under 1 ms of CPU, so one follow must cost microseconds.
describe('selection popover following the camera', () => {
  bench('follow 200 frames of a pan', () => {
    for (const selection of FRAMES) {
      followSelectionPopover({
        selection,
        size: SIZE,
        viewport: VIEWPORT,
        reserved: RESERVED,
        side: 'top',
      });
    }
  });
});
