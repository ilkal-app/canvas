import { describe, expect, it, vi } from 'vitest';

import { createHistory } from '@canvas/document';
import type { FreehandObject, ObjectId, Point, PrincipalId } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';

import { drawToolContext, PENCIL, strokesIn } from './__fixtures__/draw-tool-context.js';
import { DrawMode } from './draw-mode.js';
import type { DrawStyle } from './draw-style.js';
import type { LiveInk } from './live-ink.js';

const HIGHLIGHTER: DrawStyle = {
  tool: 'highlighter',
  stroke: { color: [0.7, 0.5, 0.1, 1], width: 16 },
  opacity: 0.4,
};

/**
 * A draw pointer event at zoom one.
 *
 * @param kind - The pointer event kind.
 * @param world - The pointer in world space.
 * @returns The draw input.
 */
function pointer(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  world: Point,
): ToolPointerInput {
  return { kind, world, screen: world, zoom: 1, isShiftPressed: false, isModPressed: false };
}

/**
 * A sink that records calls and whether it is mounted.
 *
 * @param isAttached - Whether its overlay is mounted.
 * @returns The sink and its calls.
 */
function recordingSink(isAttached = true) {
  const calls: string[] = [];
  const shown: (readonly FreehandObject[])[] = [];
  const sink = {
    isAttached: vi.fn(() => isAttached),
    show: vi.fn((pieces: readonly FreehandObject[]) => {
      calls.push('show');
      shown.push(pieces);
    }),
    release: vi.fn(() => calls.push('release')),
    clear: vi.fn(() => calls.push('clear')),
  } satisfies LiveInk;
  return { sink, calls, shown };
}

/**
 * Starts a stroke and extends it twice, leaving release to the caller.
 *
 * @param mode - The draw mode.
 */
function moveTwice(mode: DrawMode): void {
  mode.onPointer(pointer('pointerDown', { x: 10, y: 20 }));
  mode.onPointer(pointer('pointerMove', { x: 40, y: 30 }));
  mode.onPointer(pointer('pointerMove', { x: 80, y: 50 }));
}

describe('DrawMode page live ink', () => {
  it('shows each move with real highlighter opacity while engine previews stay invisible', () => {
    const { context, record } = drawToolContext(HIGHLIGHTER);
    const { sink, shown } = recordingSink();
    const writes: FreehandObject[] = [];
    const mode = new DrawMode({
      ...context,
      liveInk: sink,
      setPreview: (id, object) => {
        context.setPreview(id, object);
        if (object?.type === 'freehand') writes.push(object);
      },
    });
    moveTwice(mode);
    expect(sink.isAttached).toHaveBeenCalledTimes(4);
    expect(shown).toHaveLength(3); // press, then each move
    expect(shown.every((pieces) => pieces.length > 0)).toBe(true);
    expect(shown.at(-1)?.[0]).toMatchObject({
      id: 'new-1',
      type: 'freehand',
      tool: 'highlighter',
      opacity: 0.4,
      stroke: HIGHLIGHTER.stroke,
    });
    expect(shown.at(-1)?.[0]?.z).toBe(writes.at(-1)?.z);
    expect(shown.at(-1)?.[0]?.createdAt).toBe(writes.at(-1)?.createdAt);
    expect(writes).toHaveLength(3);
    expect(writes.every((piece) => piece.opacity === 0)).toBe(true);
    expect(record.commands).toBe(0);
  });

  it('shows later previews in the engine when an attached sink detaches mid-stroke, then releases it', () => {
    const { store, context, record } = drawToolContext(HIGHLIGHTER);
    const { sink } = recordingSink();
    let isAttached = true;
    sink.isAttached.mockImplementation(() => isAttached);
    const writes: FreehandObject[] = [];
    const mode = new DrawMode({
      ...context,
      liveInk: sink,
      setPreview: (id, object) => {
        context.setPreview(id, object);
        if (object?.type === 'freehand') writes.push(object);
      },
    });
    mode.onPointer(pointer('pointerDown', { x: 10, y: 20 }));
    mode.onPointer(pointer('pointerMove', { x: 40, y: 30 }));
    expect(sink.show).toHaveBeenCalledTimes(2);
    expect(writes.map((preview) => preview.opacity)).toEqual([0, 0]);

    isAttached = false;
    mode.onPointer(pointer('pointerMove', { x: 80, y: 50 }));
    mode.onPointer(pointer('pointerMove', { x: 100, y: 70 }));
    expect(sink.show).toHaveBeenCalledTimes(2);
    expect(writes.slice(2).map((preview) => preview.opacity)).toEqual([0.4, 0.4]);
    expect(writes.at(-1)?.opacity).toBe(0.4);
    expect((record.previews.get('new-1' as ObjectId) as FreehandObject | undefined)?.opacity).toBe(
      0.4,
    );

    mode.onPointer(pointer('pointerUp', { x: 100, y: 70 }));
    expect(strokesIn(store)).toHaveLength(1);
    expect(strokesIn(store)[0]?.opacity).toBe(0.4);
    expect(record.commands).toBe(1);
    expect(sink.release).toHaveBeenCalledTimes(1);
    expect(sink.clear).not.toHaveBeenCalled();
  });

  it('writes the same stroke and ids as the old path, then releases one undoable stroke', () => {
    const plain = drawToolContext(HIGHLIGHTER);
    const plainMode = new DrawMode(plain.context);
    moveTwice(plainMode);
    plainMode.onPointer(pointer('pointerUp', { x: 80, y: 50 }));

    const { store, context, record } = drawToolContext(HIGHLIGHTER);
    const history = createHistory(store, 'user:ada' as PrincipalId);
    const { sink, calls } = recordingSink();
    const mode = new DrawMode({
      ...context,
      liveInk: sink,
      capture: {
        command: (run) => {
          context.capture?.command(run);
          expect(strokesIn(store)).toHaveLength(1);
          calls.push('write');
        },
      },
    });
    moveTwice(mode);
    mode.onPointer(pointer('pointerUp', { x: 80, y: 50 }));
    expect(strokesIn(store)).toEqual(strokesIn(plain.store));
    expect(strokesIn(store)[0]?.opacity).toBe(0.4);
    expect(record.commands).toBe(1);
    expect(calls.at(-2)).toBe('write');
    expect(calls.at(-1)).toBe('release');
    expect(sink.release).toHaveBeenCalledTimes(1);
    expect(history.undo()).toBe(true);
    expect(strokesIn(store)).toEqual([]);
    expect(history.undo()).toBe(false);
  });

  it.each(['escape', 'exit'] as const)('%s clears an unfinished stroke without writing', (end) => {
    const { store, context, record } = drawToolContext(PENCIL);
    const { sink } = recordingSink();
    const mode = new DrawMode({ ...context, liveInk: sink });
    moveTwice(mode);
    if (end === 'escape') mode.onKey({ kind: 'escape' });
    else mode.exit();
    expect(sink.clear).toHaveBeenCalledTimes(1);
    expect(sink.release).not.toHaveBeenCalled();
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
    expect(strokesIn(store)).toEqual([]);
    expect(record.commands).toBe(0);
  });

  it('clears a refused commit instead of releasing it', () => {
    const { store, context, record } = drawToolContext({
      tool: 'pencil',
      stroke: { color: [0, 0, 0, 1], width: 0 },
    });
    const { sink } = recordingSink();
    const mode = new DrawMode({ ...context, liveInk: sink });
    moveTwice(mode);
    mode.onPointer(pointer('pointerUp', { x: 80, y: 50 }));
    expect(record.refusals).toHaveLength(1);
    expect(strokesIn(store)).toEqual([]);
    expect(sink.clear).toHaveBeenCalledTimes(1);
    expect(sink.release).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'keeps visible previews when no attached sink (sink present: %s)',
    (hasSink) => {
      const { context, record } = drawToolContext(HIGHLIGHTER);
      const { sink } = recordingSink(false);
      const mode = new DrawMode(hasSink ? { ...context, liveInk: sink } : context);
      moveTwice(mode);
      const preview = record.previews.get('new-1' as ObjectId);
      expect(preview?.type).toBe('freehand');
      if (preview?.type !== 'freehand') throw new Error('Expected a freehand preview.');
      expect(preview.opacity).toBe(0.4);
      mode.onPointer(pointer('pointerUp', { x: 80, y: 50 }));
      expect(sink.show).not.toHaveBeenCalled();
      expect(sink.release).not.toHaveBeenCalled();
      expect(sink.clear).not.toHaveBeenCalled();
    },
  );

  it('never sends an eraser gesture to live ink', () => {
    const { context } = drawToolContext({ ...PENCIL, isEraser: true });
    const { sink } = recordingSink();
    const mode = new DrawMode({ ...context, liveInk: sink });
    moveTwice(mode);
    mode.onPointer(pointer('pointerUp', { x: 80, y: 50 }));
    expect(sink.isAttached).not.toHaveBeenCalled();
    expect(sink.show).not.toHaveBeenCalled();
    expect(sink.release).not.toHaveBeenCalled();
    expect(sink.clear).not.toHaveBeenCalled();
  });
});
