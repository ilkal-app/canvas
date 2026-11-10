import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId, Point } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';
import { rect } from '../select/__fixtures__/select-board.js';
import { ADA } from '../select/__fixtures__/select-store.js';
import type { SelectPointer } from '../select/select-input.js';

import {
  drawToolContext,
  ERASER,
  strokeObject,
  strokesIn,
} from './__fixtures__/draw-tool-context.js';
import { DrawMode } from './draw-mode.js';
import { ERASER_FADE } from './eraser-gesture.js';

/**
 * A pointer input at a zoom, its screen point the world point (unused by the eraser).
 *
 * @param kind - The input's kind.
 * @param world - The point.
 * @param extra - Its trail and zoom.
 * @returns The input.
 */
function input(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  world: Point,
  extra: Partial<Pick<SelectPointer, 'trail' | 'pointerType'>> & { readonly zoom?: number } = {},
): Exclude<ToolPointerInput, { readonly kind: 'hold' | 'pointerCancel' }> {
  const { zoom = 1, ...rest } = extra;
  return { kind, screen: world, world, isShiftPressed: false, isModPressed: false, zoom, ...rest };
}

/** Three horizontal strokes, 100 long at x 100–200, at y 100, 200 and 300. */
const STROKES: readonly BoardObject[] = [100, 200, 300].map((y) =>
  strokeObject(`stroke-${String(y)}`, [0, 0, 50, 0, 100, 0], { x: 100, y }),
);

/**
 * The eraser over the three strokes and anything else given.
 *
 * @param extra - More objects on the board.
 * @returns The fixture and the mode.
 */
function setUp(extra: readonly BoardObject[] = []) {
  const fixture = drawToolContext(ERASER, [...STROKES, ...extra]);
  return { ...fixture, mode: new DrawMode(fixture.context) };
}

/**
 * The ids of the strokes still on the board, sorted.
 *
 * @param store - The fixture's store.
 * @returns The ids.
 */
function strokeIds(store: Parameters<typeof strokesIn>[0]): string[] {
  return strokesIn(store)
    .map((stroke) => stroke.id)
    .sort();
}

describe('DrawMode with the eraser', () => {
  it('fades the strokes a drag crosses, then deletes them as one command on release', () => {
    const { store, record, mode } = setUp();
    mode.onPointer(input('pointerDown', { x: 150, y: 60 }));
    mode.onPointer(input('pointerMove', { x: 150, y: 150 }));
    mode.onPointer(input('pointerMove', { x: 150, y: 240 }));
    expect(record.previews.get('stroke-100' as ObjectId)).toMatchObject({
      id: 'stroke-100',
      opacity: ERASER_FADE,
      points: [0, 0, 50, 0, 100, 0],
    });
    expect(record.previews.get('stroke-200' as ObjectId)).toMatchObject({ opacity: ERASER_FADE });
    expect(record.previews.has('stroke-300' as ObjectId)).toBe(false);
    expect(strokeIds(store)).toHaveLength(3);
    expect(record.commands).toBe(0);
    mode.onPointer(input('pointerUp', { x: 150, y: 240 }));
    expect(strokeIds(store)).toEqual(['stroke-300']);
    expect(record.commands).toBe(1);
    expect(record.previews.get('stroke-100' as ObjectId)).toBeUndefined();
    expect(record.previews.get('stroke-200' as ObjectId)).toBeUndefined();
  });

  it('fades a translucent stroke to a quarter of its opacity, once however often crossed', () => {
    const faint = strokeObject('faint', [0, 0, 100, 0], { x: 500, y: 100, opacity: 0.4 });
    const { record, mode } = setUp([faint]);
    mode.onPointer(input('pointerDown', { x: 550, y: 90 }));
    mode.onPointer(input('pointerMove', { x: 550, y: 110 }));
    mode.onPointer(input('pointerMove', { x: 560, y: 90 }));
    expect(record.previews.get('faint' as ObjectId)).toMatchObject({ opacity: 0.4 * ERASER_FADE });
    expect(record.previewWrites.filter((id) => id === 'faint')).toHaveLength(1);
  });

  it('erases ink only: a shape under the path survives', () => {
    const shape = rect('shape', null, { x: 120, y: 120, width: 60, height: 60 });
    const { store, mode } = setUp([shape]);
    mode.onPointer(input('pointerDown', { x: 150, y: 60 }));
    mode.onPointer(input('pointerMove', { x: 150, y: 340 }));
    mode.onPointer(input('pointerUp', { x: 150, y: 340 }));
    expect(strokeIds(store)).toEqual([]);
    expect(store.get('shape' as ObjectId)).toBeDefined();
  });

  it('never erases a locked or hidden stroke', () => {
    const locked = strokeObject('locked', [0, 0, 100, 0], { x: 500, y: 100, isLocked: true });
    const hidden = strokeObject('hidden', [0, 0, 100, 0], { x: 500, y: 110, isHidden: true });
    const { store, record, mode } = setUp([locked, hidden]);
    mode.onPointer(input('pointerDown', { x: 550, y: 60 }));
    mode.onPointer(input('pointerMove', { x: 550, y: 160 }));
    mode.onPointer(input('pointerUp', { x: 550, y: 160 }));
    expect(record.previews.size).toBe(0);
    expect(record.commands).toBe(0);
    expect(strokeIds(store)).toContain('locked');
    expect(strokeIds(store)).toContain('hidden');
  });

  it('sweeps through the samples coalesced into a move', () => {
    const { store, mode } = setUp();
    mode.onPointer(input('pointerDown', { x: 50, y: 50 }));
    // From (50, 50) to (50, 350) directly touches nothing; the trail detours across stroke-200.
    mode.onPointer(
      input('pointerMove', { x: 50, y: 350 }, { trail: [{ world: { x: 150, y: 195 } }] }),
    );
    mode.onPointer(input('pointerUp', { x: 50, y: 350 }));
    expect(strokeIds(store)).toEqual(['stroke-100', 'stroke-300']);
  });

  it('keeps 8 screen px of reach at every zoom', () => {
    const near = { x: 150, y: 106 }; // 6 world units from stroke-100: reach 8 + 1 at zoom 1.
    const zoomedIn = setUp();
    zoomedIn.mode.onPointer(input('pointerDown', near, { zoom: 4 })); // Reach 2 + 1.
    zoomedIn.mode.onPointer(input('pointerUp', near, { zoom: 4 }));
    expect(strokeIds(zoomedIn.store)).toHaveLength(3);
    const atOne = setUp();
    atOne.mode.onPointer(input('pointerDown', near));
    atOne.mode.onPointer(input('pointerUp', near));
    expect(strokeIds(atOne.store)).toEqual(['stroke-200', 'stroke-300']);
  });

  it('restores the touched strokes on Escape, and leaves the tool on a second Escape', () => {
    const { store, record, mode } = setUp();
    mode.onPointer(input('pointerDown', { x: 150, y: 60 }));
    mode.onPointer(input('pointerMove', { x: 150, y: 150 }));
    expect(mode.onKey({ kind: 'escape' })).toBe(true);
    expect(record.previews.get('stroke-100' as ObjectId)).toBeUndefined();
    expect(record.exitRequests).toBe(0);
    mode.onPointer(input('pointerUp', { x: 150, y: 150 }));
    expect(strokeIds(store)).toHaveLength(3);
    expect(mode.onKey({ kind: 'escape' })).toBe(true);
    expect(record.exitRequests).toBe(1);
  });

  it('restores the touched strokes when the press is cancelled or the tool is left', () => {
    const { store, record, mode } = setUp();
    mode.onPointer(input('pointerDown', { x: 150, y: 60 }));
    mode.onPointer(input('pointerMove', { x: 150, y: 150 }));
    mode.onPointer({ kind: 'pointerCancel' });
    expect(record.previews.get('stroke-100' as ObjectId)).toBeUndefined();
    mode.onPointer(input('pointerDown', { x: 150, y: 160 }));
    mode.onPointer(input('pointerMove', { x: 150, y: 240 }));
    mode.exit();
    expect(record.previews.get('stroke-200' as ObjectId)).toBeUndefined();
    expect(strokeIds(store)).toHaveLength(3);
    expect(record.commands).toBe(0);
  });

  it('drops a stroke a peer deleted mid-drag and erases the rest', () => {
    const { store, record, mode } = setUp();
    mode.onPointer(input('pointerDown', { x: 150, y: 60 }));
    mode.onPointer(input('pointerMove', { x: 150, y: 240 }));
    store.transact(ADA, (transaction) => {
      transaction.deleteObject('stroke-100' as ObjectId);
    });
    mode.onPointer(input('pointerMove', { x: 150, y: 250 }));
    expect(record.previews.get('stroke-100' as ObjectId)).toBeUndefined();
    mode.onPointer(input('pointerUp', { x: 150, y: 250 }));
    expect(record.refusals).toEqual([]);
    expect(strokeIds(store)).toEqual(['stroke-300']);
  });

  it('fades a stroke a peer changed mid-drag as it is now, and leaves one a peer locked', () => {
    const { store, record, mode } = setUp();
    mode.onPointer(input('pointerDown', { x: 150, y: 60 }));
    mode.onPointer(input('pointerMove', { x: 150, y: 240 }));
    const first = store.get('stroke-100' as ObjectId);
    const second = store.get('stroke-200' as ObjectId);
    if (first?.type !== 'freehand' || second?.type !== 'freehand') throw new Error('no strokes');
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...first, stroke: { ...first.stroke, width: 5 } });
      transaction.setObject({ ...second, locked: true });
    });
    mode.onPointer(input('pointerMove', { x: 150, y: 245 }));
    expect(record.previews.get('stroke-100' as ObjectId)).toMatchObject({
      stroke: { width: 5 },
      opacity: ERASER_FADE,
    });
    mode.onPointer(input('pointerUp', { x: 150, y: 245 }));
    expect(strokeIds(store)).toEqual(['stroke-200', 'stroke-300']);
  });

  it('reports a refused deletion and erases nothing', () => {
    const { store, context, record } = drawToolContext(ERASER, STROKES);
    // A peer deletes stroke-100 between the check and the command: deleteObjects refuses.
    const mode = new DrawMode({
      ...context,
      capture: {
        command: (run) => {
          store.transact(ADA, (transaction) => {
            transaction.deleteObject('stroke-100' as ObjectId);
          });
          run();
        },
      },
    });
    mode.onPointer(input('pointerDown', { x: 150, y: 60 }));
    mode.onPointer(input('pointerMove', { x: 150, y: 240 }));
    mode.onPointer(input('pointerUp', { x: 150, y: 240 }));
    expect(record.refusals).toHaveLength(1);
    expect(strokeIds(store)).toEqual(['stroke-200', 'stroke-300']);
    expect(record.previews.get('stroke-200' as ObjectId)).toBeUndefined();
  });

  it('erases nothing for a finger once a pen was seen (palm rejection)', () => {
    const { store, mode } = setUp();
    mode.onPointer(input('pointerMove', { x: 0, y: 0 }, { pointerType: 'pen' }));
    mode.onPointer(input('pointerDown', { x: 150, y: 60 }, { pointerType: 'touch' }));
    mode.onPointer(input('pointerMove', { x: 150, y: 340 }, { pointerType: 'touch' }));
    mode.onPointer(input('pointerUp', { x: 150, y: 340 }, { pointerType: 'touch' }));
    expect(strokeIds(store)).toHaveLength(3);
  });

  it('reads every object of the store without an index or a source, and runs uncaptured', () => {
    const { store, context } = drawToolContext(ERASER, STROKES);
    const { capture, hitIndex, source, ...bare } = context;
    expect([capture, hitIndex, source].every((field) => field !== undefined)).toBe(true);
    const mode = new DrawMode(bare);
    mode.onPointer(input('pointerDown', { x: 150, y: 60 }));
    mode.onPointer(input('pointerMove', { x: 150, y: 150 }));
    mode.onPointer(input('pointerUp', { x: 150, y: 150 }));
    expect(strokeIds(store)).toEqual(['stroke-200', 'stroke-300']);
  });
});
