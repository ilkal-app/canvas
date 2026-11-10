// @vitest-environment jsdom
// The live cursors' layer (item 10) at the budget's twenty collaborators (CLAUDE.md,
// "Budgets"): one presence flush that moves every cursor, one that relabels them all (a name, a
// colourway or an agent's ✦ changed), and one camera frame that places them all. A move
// writes a transform per cursor and nothing else; the easing's frames are not run.
import { bench, describe } from 'vitest';

import { PRESENCE_COLOURWAYS } from '@canvas/collab';

import { PeerCursorLayer, type CursorFrames } from './peer-cursor-layer.js';
import type { PeerCursor } from './peer-cursors-model.js';

const PEERS = 20;
const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 1440, viewportHeightPx: 900, dpr: 1 };
const NO_FRAMES: CursorFrames = { request: () => 1, cancel: () => undefined };

/**
 * Twenty peers' cursors, moved by a step.
 *
 * @param step - How far each has moved, world units.
 * @returns The cursors.
 */
function cursorsAt(step: number): PeerCursor[] {
  const cursors: PeerCursor[] = [];
  for (let index = 0; index < PEERS; index += 1) {
    cursors.push({
      clientId: index + 1,
      principalId: `peer-${String(index)}`,
      name: `Peer ${String(index)}`,
      color: '#3366cc',
      colourway: PRESENCE_COLOURWAYS[index % PRESENCE_COLOURWAYS.length] ?? 'neeli',
      // One in four is an agent, its tag carrying a ✦.
      isAgent: index % 4 === 0,
      point: { x: index * 40 + step, y: index * 20 + step },
    });
  }
  return cursors;
}

describe(`live cursors: ${String(PEERS)} collaborators`, () => {
  const layer = new PeerCursorLayer(document.createElement('div'), NO_FRAMES, () => false);
  layer.setCamera(CAMERA);
  layer.setCursors(cursorsAt(0));
  let step = 0;
  bench('a presence flush moving every cursor', () => {
    step += 1;
    layer.setCursors(cursorsAt(step));
  });
  bench('a presence flush relabelling every cursor (new names, colourways and agents)', () => {
    step += 1;
    layer.setCursors(
      cursorsAt(step).map((cursor) => ({
        ...cursor,
        name: `${cursor.name} ${String(step)}`,
        isAgent: !cursor.isAgent,
      })),
    );
  });
  bench('a camera frame placing every cursor', () => {
    step += 1;
    layer.setCamera({ ...CAMERA, x: step });
  });
});
