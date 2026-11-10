import { describe, expect, it } from 'vitest';

import type { Point } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';

import { ImageMode, type ImageModeContext } from './image-mode.js';

/** A picker the test closes by hand. */
interface Picks {
  readonly at: (Point | undefined)[];
  readonly close: (() => void)[];
  readonly fail: (() => void)[];
  exits: number;
}

/**
 * The image tool with a picker the test controls.
 *
 * @returns The mode and what it asked for.
 */
function imageTool(): { mode: ImageMode; picks: Picks } {
  const picks: Picks = { at: [], close: [], fail: [], exits: 0 };
  const context: ImageModeContext = {
    pickImages: (at) =>
      new Promise((resolve, reject) => {
        picks.at.push(at);
        picks.close.push(resolve);
        picks.fail.push(() => {
          reject(new Error('The picker did not open.'));
        });
      }),
    requestExit: () => {
      picks.exits += 1;
    },
  };
  return { mode: new ImageMode(context), picks };
}

/**
 * A pointer input at a world point.
 *
 * @param kind - Which input.
 * @param world - Where, world units.
 * @returns The input.
 */
function at(kind: 'pointerDown' | 'pointerUp', world: Point): ToolPointerInput {
  return { kind, world, screen: world, zoom: 1, isShiftPressed: false, isModPressed: false };
}

/**
 * Lets settled promises run their callbacks.
 *
 * @returns Settles after the microtasks queued so far.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('ImageMode', () => {
  it('opens the picker for the view’s centre at once and hands back once it closes', async () => {
    const { mode, picks } = imageTool();
    expect(mode.id).toBe('image');
    expect(mode.cursor).toBe('crosshair');
    expect(picks.at).toEqual([undefined]);
    picks.close[0]?.();
    await flush();
    expect(picks.exits).toBe(1);
  });

  it('opens the picker again for a click, placing the images where it clicked', async () => {
    const { mode, picks } = imageTool();
    mode.onPointer(at('pointerDown', { x: 5, y: 6 }));
    expect(mode.onPointer(at('pointerUp', { x: 5, y: 6 })).isDone).toBe(false);
    expect(picks.at).toEqual([undefined, { x: 5, y: 6 }]);
    picks.fail[1]?.();
    await flush();
    expect(picks.exits).toBe(1);
  });

  it('opens nothing for a release without a press, or after a cancelled press', () => {
    const { mode, picks } = imageTool();
    mode.onPointer(at('pointerUp', { x: 0, y: 0 }));
    mode.onPointer(at('pointerDown', { x: 0, y: 0 }));
    mode.onPointer({ kind: 'pointerCancel' });
    mode.onPointer(at('pointerUp', { x: 0, y: 0 }));
    expect(picks.at).toHaveLength(1);
  });

  it('hands back on Escape and leaves other keys to the select tool', () => {
    const { mode, picks } = imageTool();
    expect(mode.onKey({ kind: 'enter' })).toBe(false);
    expect(mode.onKey({ kind: 'escape' })).toBe(true);
    expect(picks.exits).toBe(1);
    expect(mode.overlay()).toEqual({});
  });

  it('asks nothing once ended, when a picker closes late', async () => {
    const { mode, picks } = imageTool();
    mode.exit();
    picks.close[0]?.();
    await flush();
    expect(picks.exits).toBe(0);
  });
});
