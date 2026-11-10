// The draw tool tells the live ink overlay when each input it shows was made, so the
// ink latency readout can time input to the overlay's paint.
import { describe, expect, it, vi } from 'vitest';

import type { FreehandObject, Point } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';

import { drawToolContext, PENCIL } from './__fixtures__/draw-tool-context.js';
import { DrawMode } from './draw-mode.js';
import type { LiveInk } from './live-ink.js';

/**
 * A draw pointer event at zoom one, made at a time.
 *
 * @param kind - The pointer event kind.
 * @param world - The pointer in world space.
 * @param timeStamp - When it was made, ms; none if absent.
 * @returns The draw input.
 */
function pointer(
  kind: 'pointerDown' | 'pointerMove',
  world: Point,
  timeStamp?: number,
): ToolPointerInput {
  return {
    kind,
    world,
    screen: world,
    zoom: 1,
    isShiftPressed: false,
    isModPressed: false,
    ...(timeStamp === undefined ? {} : { timeStamp }),
  };
}

describe('DrawMode live ink input times', () => {
  it('shows each press and move with the time its input was made, or none when unknown', () => {
    const { context } = drawToolContext(PENCIL);
    const times: (number | undefined)[] = [];
    const sink = {
      isAttached: () => true,
      show: vi.fn((...shown: [readonly FreehandObject[], number?]) => {
        times.push(shown[1]);
      }),
      release: vi.fn(),
      clear: vi.fn(),
    } satisfies LiveInk;
    const mode = new DrawMode({ ...context, liveInk: sink });
    mode.onPointer(pointer('pointerDown', { x: 10, y: 20 }, 100));
    mode.onPointer(pointer('pointerMove', { x: 40, y: 30 }, 108));
    mode.onPointer(pointer('pointerMove', { x: 80, y: 50 }));
    expect(times).toEqual([100, 108, undefined]);
  });
});
