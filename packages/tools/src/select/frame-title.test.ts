import { describe, expect, it } from 'vitest';

import type { BoardObject, FrameObject } from '@canvas/schema';

import {
  frame,
  group,
  id,
  indexOf,
  mapSource,
  selectBoardObjects,
} from './__fixtures__/select-board.js';
import {
  FRAME_TITLE_BAND_PX,
  frameTitleAt,
  isAboveFrameTop,
  isOnFrameTitle,
} from './frame-title.js';

function board(extra: readonly BoardObject[] = []) {
  const objects = [...selectBoardObjects(), ...extra];
  return { index: indexOf(objects), source: mapSource(objects) };
}

function frameF(source: ReturnType<typeof mapSource>): FrameObject {
  const object = source.get(id('frame-f'));
  if (object?.type !== 'frame') throw new Error('frame-f is missing');
  return object;
}

describe('isOnFrameTitle', () => {
  it('holds the strip of FRAME_TITLE_BAND_PX above the top edge, across the frame’s width', () => {
    const { source } = board();
    const f = frameF(source);
    // frame-f spans x 400–700 from y 0; its band is y −24 up to (not including) 0 at 100%.
    expect(FRAME_TITLE_BAND_PX).toBe(24);
    expect(isOnFrameTitle(f, source, { x: 400, y: -1 }, 1)).toBe(true);
    expect(isOnFrameTitle(f, source, { x: 700, y: -24 }, 1)).toBe(true);
    expect(isOnFrameTitle(f, source, { x: 550, y: -24.5 }, 1)).toBe(false);
    expect(isOnFrameTitle(f, source, { x: 550, y: 0 }, 1)).toBe(false);
    expect(isOnFrameTitle(f, source, { x: 399, y: -10 }, 1)).toBe(false);
    expect(isOnFrameTitle(f, source, { x: 701, y: -10 }, 1)).toBe(false);
  });

  it('keeps the band the same height on screen: twice as tall on the board at 50%', () => {
    const { source } = board();
    const f = frameF(source);
    expect(isOnFrameTitle(f, source, { x: 550, y: -40 }, 1)).toBe(false);
    expect(isOnFrameTitle(f, source, { x: 550, y: -40 }, 0.5)).toBe(true);
    expect(isOnFrameTitle(f, source, { x: 550, y: -40 }, 2)).toBe(false);
    expect(isOnFrameTitle(f, source, { x: 550, y: -11 }, 2)).toBe(true);
  });

  it('turns the band with its frame: above the frame’s own top edge', () => {
    // A quarter turn clockwise about (1000, 0): the frame covers x 950–1000, y 0–100, and its
    // top edge is the line x = 1000, so its band is x 1000–1024.
    const turned = frame('frame-turned', null, {
      x: 1000,
      y: 0,
      width: 100,
      height: 50,
      rotation: Math.PI / 2,
    });
    const { source } = board([turned]);
    expect(isOnFrameTitle(turned, source, { x: 1010, y: 50 }, 1)).toBe(true);
    expect(isOnFrameTitle(turned, source, { x: 990, y: 50 }, 1)).toBe(false);
    expect(isOnFrameTitle(turned, source, { x: 1010, y: 110 }, 1)).toBe(false);
  });
});

describe('frameTitleAt', () => {
  it('finds the frame whose band holds the point, and nothing off every band', () => {
    const { index, source } = board();
    expect(frameTitleAt(index, source, { x: 600, y: -10 }, 1)).toBe('frame-f');
    expect(frameTitleAt(index, source, { x: 600, y: 10 }, 1)).toBeUndefined();
    expect(frameTitleAt(index, source, { x: 50, y: -10 }, 1)).toBeUndefined();
  });

  it('finds a nested frame’s band over its parent’s background when its name is shown', () => {
    // frame-n at (100, 100) in frame-f, so (500, 100) on the board: its band is y 76–100.
    const nested = {
      ...frame('frame-n', 'frame-f', { x: 100, y: 100, width: 100, height: 80 }),
      showName: true,
    };
    const { index, source } = board([nested]);
    expect(frameTitleAt(index, source, { x: 550, y: 90 }, 1)).toBe('frame-n');
  });

  it('finds no band for a hidden name: a nested frame by default, or showName false', () => {
    const nested = frame('frame-n', 'frame-f', { x: 100, y: 100, width: 100, height: 80 });
    const hidden = {
      ...frame('frame-h', null, { x: 0, y: 1000, width: 200, height: 100 }),
      showName: false,
    };
    const { index, source } = board([nested, hidden]);
    expect(frameTitleAt(index, source, { x: 550, y: 90 }, 1)).toBeUndefined();
    expect(frameTitleAt(index, source, { x: 50, y: 990 }, 1)).toBeUndefined();
  });

  it('finds the band of a frame with only groups above it, and none through a group in a frame', () => {
    // frame-g in group-h in group-g, at (0, 300) + (60, 0) + (0, 100) = (60, 400) on the board.
    const grouped = frame('frame-g', 'group-h', { x: 0, y: 100, width: 100, height: 50 });
    const inFrame = { ...group('group-in-f', 'frame-f', 0, 0), z: 'a9' };
    const deep = frame('frame-deep', 'group-in-f', { x: 100, y: 120, width: 100, height: 50 });
    const { index, source } = board([grouped, inFrame, deep]);
    expect(frameTitleAt(index, source, { x: 80, y: 390 }, 1)).toBe('frame-g');
    // frame-deep at (500, 120) on the board, inside frame-f through a group: no band.
    expect(frameTitleAt(index, source, { x: 550, y: 110 }, 1)).toBeUndefined();
  });

  it('takes the topmost of two bands that overlap', () => {
    const lower = {
      ...frame('frame-low', null, { x: 0, y: 1000, width: 200, height: 100 }),
      z: 'a1',
    };
    const upper = {
      ...frame('frame-up', null, { x: 100, y: 1000, width: 200, height: 100 }),
      z: 'a2',
    };
    const { index, source } = board([lower, upper]);
    expect(frameTitleAt(index, source, { x: 150, y: 990 }, 1)).toBe('frame-up');
    expect(frameTitleAt(index, source, { x: 50, y: 990 }, 1)).toBe('frame-low');
  });

  it('hides the part of a shown nested band that a clipping ancestor cuts away', () => {
    const clipping = {
      ...frame('clip-p', null, { x: 2000, y: 0, width: 100, height: 100 }),
      clip: true,
      showName: false,
    };
    // Shown on request: nested frames hide their names by default.
    const nested = {
      ...frame('clip-q', 'clip-p', { x: 10, y: 10, width: 50, height: 50 }),
      showName: true,
    };
    const { index, source } = board([clipping, nested]);
    // The nested band is y −14..10: inside the clipping frame below y 0, cut away above it.
    expect(frameTitleAt(index, source, { x: 2030, y: 5 }, 1)).toBe('clip-q');
    expect(frameTitleAt(index, source, { x: 2030, y: -5 }, 1)).toBeUndefined();
  });

  it('counts only the bands of the frames the caller accepts', () => {
    const { index, source } = board();
    expect(frameTitleAt(index, source, { x: 600, y: -10 }, 1, () => false)).toBeUndefined();
    expect(
      frameTitleAt(index, source, { x: 600, y: -10 }, 1, (frameId) => frameId === 'frame-f'),
    ).toBe('frame-f');
  });
});

describe('isAboveFrameTop', () => {
  it('tells a point above a turned frame’s top edge from one on its body', () => {
    const turned = frame('t', null, {
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      rotation: Math.PI / 2,
    });
    const source = mapSource([turned]);
    // Turned a quarter, the frame's top edge runs down from (100, 100); "above" it is to the right.
    expect(isAboveFrameTop(turned, source, { x: 110, y: 150 })).toBe(true);
    expect(isAboveFrameTop(turned, source, { x: 90, y: 150 })).toBe(false);
  });
});
