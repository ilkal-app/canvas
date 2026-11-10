import { describe, expect, it } from 'vitest';

import { context, resize } from './__fixtures__/drag-snap-steps.js';
import type { OrientedBox } from './oriented-box.js';
import { snapResize } from './resize-snap.js';

describe('snapResize', () => {
  const box: OrientedBox = { x: 20, y: 200, width: 60, height: 40, rotation: 0 };

  it('snaps the dragged right edge and keeps the anchored left edge where it is', () => {
    const { intent, guides } = snapResize(resize(box, 'e', 17, 0), context());
    expect(intent.to).toEqual({ x: 20, y: 200, width: 80, height: 40, rotation: 0 });
    expect(intent.delta).toEqual({ x: 20, y: 0 });
    expect(guides).toEqual([{ axis: 'x', position: 100, from: 0, to: 240 }]);
  });

  it('snaps the dragged left edge and keeps the right edge fixed', () => {
    const wide: OrientedBox = { x: 60, y: 200, width: 100, height: 40, rotation: 0 };
    const { intent } = snapResize(resize(wide, 'w', -8, 0), context());
    expect(intent.to).toEqual({ x: 50, y: 200, width: 110, height: 40, rotation: 0 });
  });

  it('snaps only the edges a corner handle drags', () => {
    const low: OrientedBox = { x: 20, y: 20, width: 60, height: 40, rotation: 0 };
    const { intent } = snapResize(resize(low, 'se', 17, 37), context());
    // The right edge and the bottom both reach 97 and snap to 100; the top-left stays.
    expect(intent.to).toEqual({ x: 20, y: 20, width: 80, height: 80, rotation: 0 });
  });

  it('keeps the aspect ratio with Shift, led by the edge nearer a line', () => {
    const square: OrientedBox = { x: 10, y: 10, width: 40, height: 40, rotation: 0 };
    // Unsnapped, the corner reaches (97, 97) − a 87-wide square; the right edge leads to 100.
    const { intent, guides } = snapResize(resize(square, 'se', 47, 47, true), context());
    expect(intent.to.width).toBeCloseTo(90, 9);
    expect(intent.to.height).toBeCloseTo(90, 9);
    expect(intent.to.x).toBe(10);
    expect(guides.map((guide) => guide.position)).toEqual([100, 100]);
  });

  it('lets the bottom edge lead a Shift resize when it is nearer a line, and leaves one near none', () => {
    const square: OrientedBox = { x: 10, y: 10, width: 40, height: 40, rotation: 0 };
    const tall: OrientedBox = { x: 10, y: 10, width: 40, height: 80, rotation: 0 };
    const { intent } = snapResize(resize(tall, 'se', 1, 11, true), context());
    // Unsnapped, 91/80 scales it to 45.5 × 91: the right edge 55.5 is 5.5 from 50, the bottom
    // 101 only 1 from 100, so the bottom leads and the width follows.
    expect(intent.to.height).toBeCloseTo(90, 9);
    expect(intent.to.width).toBeCloseTo(45, 9);
    const alone = resize(square, 'se', 200, 200, true);
    expect(snapResize(alone, context()).intent.delta).toEqual(alone.delta);
  });

  it('keeps a lone image’s drawn aspect, not its box’s, led by the edge nearer a line', () => {
    // A box a merge left at 4:1 of an image drawn at 2:1.
    const offAspect: OrientedBox = { x: 10, y: 10, width: 40, height: 10, rotation: 0 };
    // Unsnapped, the right edge reaches 98 (88 wide, 44 high): it leads to 100.
    const across = snapResize(resize(offAspect, 'se', 48, 0, true, 2), context()).intent;
    expect(across.to.width).toBeCloseTo(90, 9);
    expect(across.to.height).toBeCloseTo(45, 9);
    // Unsnapped, the bottom reaches 99 (178 wide, 89 high): it leads to 100.
    const down = snapResize(resize(offAspect, 'se', 0, 79, true, 2), context()).intent;
    expect(down.to.height).toBeCloseTo(90, 9);
    expect(down.to.width).toBeCloseTo(180, 9);
  });

  it('keeps an image’s aspect snapping from the top-left, and leaves a flat frame unsnapped', () => {
    const offAspect: OrientedBox = { x: 110, y: 110, width: 40, height: 10, rotation: 0 };
    // The left edge reaches 3 (147 wide takes 73.5 high, the top at 46.5): it leads to 0.
    const { intent } = snapResize(resize(offAspect, 'nw', -107, 0, true, 2), context());
    expect(intent.to.x).toBeCloseTo(0, 9);
    expect(intent.to.width).toBeCloseTo(150, 9);
    expect(intent.to.height).toBeCloseTo(75, 9);
    // A frame of no height has no aspect of its own to keep: the pointer's own displacement.
    const flat: OrientedBox = { x: 10, y: 10, width: 40, height: 0, rotation: 0 };
    const unsnapped = resize(flat, 's', 0, 89, true);
    expect(snapResize(unsnapped, context()).intent.delta).toEqual(unsnapped.delta);
  });

  it('snaps a frame turned half round by the world edge its handle drags', () => {
    // Turned 180° about (160, 100), it covers x 100–160, y 60–100; its own right edge is the
    // world's left. Dragged 53 left, that edge reaches 47 and snaps to 50.
    const half: OrientedBox = { x: 160, y: 100, width: 60, height: 40, rotation: Math.PI };
    const { intent, guides } = snapResize(resize(half, 'e', -53, 0), context());
    expect(intent.to.width).toBeCloseTo(110, 9);
    expect(intent.to).toMatchObject({ x: 160, y: 100, height: 40, rotation: Math.PI });
    expect(guides).toHaveLength(1);
    expect(guides[0]?.axis).toBe('x');
    expect(guides[0]?.position).toBeCloseTo(50, 9);
  });

  it('snaps a frame turned a quarter round, its own y along the world’s negative x', () => {
    // Turned 90° about (200, 0), it covers x 160–200, y 0–60; its bottom edge is the world's
    // left. Dragged 57 left, that edge reaches 103 and snaps to 100.
    const quarter: OrientedBox = { x: 200, y: 0, width: 60, height: 40, rotation: Math.PI / 2 };
    const { intent } = snapResize(resize(quarter, 's', -57, 0), context());
    expect(intent.to.height).toBeCloseTo(100, 9);
    expect(intent.to.width).toBe(60);
    const proportional = snapResize(resize(quarter, 's', -57, 0, true), context());
    expect(proportional.intent.to.height).toBeCloseTo(100, 9);
    expect(proportional.intent.to.width).toBeCloseTo(150, 9);
  });

  it('does not snap a turned frame, whose edges are not the world’s axes', () => {
    const turned = { ...box, rotation: 0.3 };
    const original = resize(turned, 'e', 17, 0);
    const { intent, guides } = snapResize(original, context());
    expect(intent).toBe(original);
    expect(guides).toEqual([]);
  });
});
