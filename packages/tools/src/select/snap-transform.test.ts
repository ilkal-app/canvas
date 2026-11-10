import { describe, expect, it } from 'vitest';

import { move, resize } from './__fixtures__/drag-snap-steps.js';
import { id, indexOf, mapSource, selectBoardObjects } from './__fixtures__/select-board.js';
import { SNAPPING_OFF } from './drag-snap.js';
import type { OrientedBox } from './oriented-box.js';
import { snapTransform, type DragSnapRequest } from './snap-transform.js';

describe('snapTransform', () => {
  const objects = selectBoardObjects();
  const request: DragSnapRequest = {
    settings: { isEnabled: true, isGridVisible: false },
    isSuspended: false,
    index: indexOf(objects),
    source: mapSource(objects),
    movingIds: [id('rect-a')],
    start: { x: 0, y: 0, width: 100, height: 50, rotation: 0 },
    zoom: 1,
  };

  it('snaps a move against the index, looking everywhere when given no viewport', () => {
    // rect-a moved by 47 has its right edge 3 short of rect-b's turned left edge at 150.
    const { intent, guides } = snapTransform(move(47, 0), request);
    expect(intent).toMatchObject({ delta: { x: 50, y: 0 } });
    expect(guides.length).toBeGreaterThan(0);
  });

  it('snaps a resize, but not a rotation, a move with no frame, or anything while off or suspended', () => {
    const from: OrientedBox = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };
    expect(snapTransform(resize(from, 'e', 47, 0), request).intent).toMatchObject({
      to: { width: 150 },
    });
    const rotate = {
      type: 'rotate',
      angle: 0.1,
      isSnapped: false,
      pivot: { x: 50, y: 25 },
      from,
    } as const;
    expect(snapTransform(rotate, request).intent).toBe(rotate);
    const unframed = move(47, 0);
    expect(snapTransform(unframed, { ...request, start: undefined }).intent).toBe(unframed);
    expect(snapTransform(unframed, { ...request, settings: SNAPPING_OFF }).intent).toBe(unframed);
    expect(snapTransform(unframed, { ...request, isSuspended: true }).intent).toBe(unframed);
    expect(snapTransform(unframed, { ...request, index: undefined }).intent).toEqual(unframed);
  });
});
