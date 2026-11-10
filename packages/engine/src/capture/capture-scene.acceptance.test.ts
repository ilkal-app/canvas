// Acceptance: written before the capture implementation.
// CONTRACT: render tiles sequentially and stitch their top-down RGBA8 bytes exactly.
// Deliberately not asserted: browser canvas creation, GPU output, PNG, PDF, or export UI.
import { describe, expect, it } from 'vitest';

import { planCapture } from './capture-plan.js';
import { captureScene } from './capture-scene.js';

const PLAN = planCapture({ x: 7, y: 9, width: 5, height: 3 }, 1, {
  maxTilePx: 3,
  maxEdgePx: 10,
  maxPixels: 100,
});

function colorTile(widthPx: number, heightPx: number, index: number): Uint8Array {
  const bytes = new Uint8Array(widthPx * heightPx * 4);
  for (let offset = 0; offset < bytes.length; offset += 4) {
    bytes.set([index + 1, index + 11, index + 21, 255], offset);
  }
  return bytes;
}

describe('capture scene acceptance', () => {
  it('stitches four tile colours into their exact rectangles', async () => {
    expect(
      PLAN.tiles.map(({ xPx, yPx, widthPx, heightPx }) => [xPx, yPx, widthPx, heightPx]),
    ).toEqual([
      [0, 0, 3, 3],
      [3, 0, 2, 3],
    ]);
    const fourTilePlan = planCapture({ x: 7, y: 9, width: 5, height: 5 }, 1, {
      maxTilePx: 3,
      maxEdgePx: 10,
      maxPixels: 100,
    });
    const image = await captureScene(fourTilePlan, (tile) => {
      const index = fourTilePlan.tiles.indexOf(tile);
      return Promise.resolve(colorTile(tile.widthPx, tile.heightPx, index));
    });
    expect([image.widthPx, image.heightPx]).toEqual([5, 5]);
    for (const [x, y] of [
      [0, 0],
      [2, 2],
      [3, 0],
      [4, 2],
      [0, 3],
      [2, 4],
      [3, 3],
      [4, 4],
    ] as const) {
      const index = (y >= 3 ? 2 : 0) + (x >= 3 ? 1 : 0);
      expect([...image.rgba.slice((y * 5 + x) * 4, (y * 5 + x) * 4 + 4)]).toEqual([
        index + 1,
        index + 11,
        index + 21,
        255,
      ]);
    }
  });

  it('starts each tile only after the previous tile finishes, in plan order', async () => {
    const events: string[] = [];
    let isInFlight = false;
    await captureScene(PLAN, async (tile) => {
      const index = PLAN.tiles.indexOf(tile);
      expect(isInFlight).toBe(false);
      isInFlight = true;
      events.push(`start ${String(index)}`);
      await Promise.resolve();
      events.push(`end ${String(index)}`);
      isInFlight = false;
      return colorTile(tile.widthPx, tile.heightPx, index);
    });
    expect(events).toEqual(['start 0', 'end 0', 'start 1', 'end 1']);
  });

  it('rejects a wrongly sized tile and names it', async () => {
    await expect(captureScene(PLAN, () => Promise.resolve(new Uint8Array(1)))).rejects.toThrow(
      RangeError,
    );
    await expect(captureScene(PLAN, () => Promise.resolve(new Uint8Array(1)))).rejects.toThrow(
      /tile/i,
    );
  });

  it('propagates render failure and never requests a later tile', async () => {
    const error = new Error('tile draw failed');
    const calls: number[] = [];
    const threeTilePlan = planCapture({ x: 7, y: 9, width: 7, height: 3 }, 1, {
      maxTilePx: 3,
      maxEdgePx: 10,
      maxPixels: 100,
    });
    expect(threeTilePlan.tiles).toHaveLength(3);
    await expect(
      captureScene(threeTilePlan, (tile) => {
        const index = threeTilePlan.tiles.indexOf(tile);
        calls.push(index);
        if (index === 1) return Promise.reject(error);
        return Promise.resolve(colorTile(tile.widthPx, tile.heightPx, index));
      }),
    ).rejects.toBe(error);
    expect(calls).toEqual([0, 1]);
  });

  it('returns the RGBA bytes of a one-tile capture', async () => {
    const oneTile = planCapture({ x: 0, y: 0, width: 2, height: 2 }, 1);
    const bytes = colorTile(2, 2, 5);
    const image = await captureScene(oneTile, () => Promise.resolve(bytes));
    expect(image).toEqual({ widthPx: 2, heightPx: 2, rgba: bytes });
  });
});
