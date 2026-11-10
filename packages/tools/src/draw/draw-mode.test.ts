import { describe, expect, it } from 'vitest';

import { MAX_FREEHAND_POINTS, type ObjectId, type Point } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';
import type { SelectPointer } from '../select/select-input.js';

import { drawToolContext, PENCIL, strokesIn } from './__fixtures__/draw-tool-context.js';
import { DrawMode } from './draw-mode.js';

/** A pointer input's extra fields: its kind of pointer, pressure and trail. */
type Extra = Partial<Pick<SelectPointer, 'pointerType' | 'pressure' | 'trail'>>;

/**
 * A pointer input at zoom 1, where screen and world points coincide.
 *
 * @param kind - The input's kind.
 * @param world - The point.
 * @param extra - Its pointer type, pressure and trail.
 * @returns The input.
 */
function input(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  world: Point,
  extra: Extra = {},
): Exclude<ToolPointerInput, { readonly kind: 'hold' | 'pointerCancel' }> {
  return {
    kind,
    screen: world,
    world,
    isShiftPressed: false,
    isModPressed: false,
    zoom: 1,
    ...extra,
  };
}

/**
 * Draws through points: a press at the first, a move to each of the rest, a release at the last.
 *
 * @param mode - The draw tool.
 * @param points - The points, at least one.
 * @param extra - Held through the stroke.
 */
function draw(mode: DrawMode, points: readonly Point[], extra: Extra = {}): void {
  const [first, ...rest] = points;
  if (first === undefined) return;
  mode.onPointer(input('pointerDown', first, extra));
  for (const point of rest) mode.onPointer(input('pointerMove', point, extra));
  mode.onPointer(input('pointerUp', points.at(-1) ?? first, extra));
}

/** A curve through the board, one point every 10 units. */
const CURVE: readonly Point[] = Array.from({ length: 12 }, (unused, index) => ({
  x: 300 + index * 10,
  y: 400 + Math.sin(index / 2) * 30,
}));

describe('DrawMode', () => {
  it('draws a stroke by drag as one createObjects, keeps the tool and selects nothing', () => {
    const { store, context, record } = drawToolContext();
    const mode = new DrawMode(context);
    expect(mode.id).toBe('draw');
    expect(mode.cursor).toBe('crosshair');
    const [first, ...rest] = CURVE;
    if (first === undefined) throw new Error('no curve');
    expect(mode.onPointer(input('pointerDown', first)).isDone).toBe(false);
    for (const point of rest)
      expect(mode.onPointer(input('pointerMove', point)).isDone).toBe(false);
    expect(strokesIn(store)).toEqual([]);
    expect(record.commands).toBe(0);
    expect(mode.onPointer(input('pointerUp', CURVE.at(-1) ?? first)).isDone).toBe(false);
    const strokes = strokesIn(store);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toMatchObject({ tool: 'pencil', x: 300, y: 400, stroke: PENCIL.stroke });
    expect((strokes[0]?.points.length ?? 0) / 2).toBeGreaterThanOrEqual(2);
    expect(record.commands).toBe(1);
  });

  it('previews the stroke per move without writing, and drops the preview on release', () => {
    const { store, context, record } = drawToolContext();
    const mode = new DrawMode(context);
    mode.onPointer(input('pointerDown', { x: 0, y: 0 }));
    mode.onPointer(input('pointerMove', { x: 10, y: 5 }));
    mode.onPointer(input('pointerMove', { x: 20, y: 0 }));
    const preview = record.previews.get('new-1' as ObjectId);
    expect(preview).toMatchObject({ type: 'freehand', x: 0, y: 0, points: [0, 0, 10, 5, 20, 0] });
    expect(record.previewWrites.filter((id) => id === 'new-1').length).toBe(3);
    expect(strokesIn(store)).toEqual([]);
    mode.onPointer(input('pointerUp', { x: 20, y: 0 }));
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
  });

  it('writes the stroke under its preview ids, so it takes its preview’s place', () => {
    const { store, context, record } = drawToolContext();
    const points = Array.from({ length: MAX_FREEHAND_POINTS + 200 }, (unused, index) => ({
      x: index * 4,
      y: (index % 2) * 40,
    }));
    draw(new DrawMode(context), points);
    const previewed = [...record.previews.keys()];
    expect(previewed).toHaveLength(2);
    expect(strokesIn(store).map(({ id }) => id)).toEqual(previewed);
    // The previews go after the write: the scene sees an update, not a removal and an arrival.
    expect([...record.previews.values()].every((preview) => preview === undefined)).toBe(true);
  });

  it('adds the raw samples coalesced into a move, not its aggregate point', () => {
    const { context, record } = drawToolContext();
    const mode = new DrawMode(context);
    mode.onPointer(input('pointerDown', { x: 0, y: 0 }));
    mode.onPointer(
      input(
        'pointerMove',
        { x: 30, y: 0 },
        {
          trail: [
            { world: { x: 10, y: 8 } },
            { world: { x: 20, y: 8 } },
            { world: { x: 29, y: 1 } },
          ],
        },
      ),
    );
    // The raw samples, the last included; the move's aggregate point (30, 0) is not added.
    expect(record.previews.get('new-1' as ObjectId)).toMatchObject({
      points: [0, 0, 10, 8, 20, 8, 29, 1],
    });
  });

  it('makes a one-point dot of a click', () => {
    const { store, context, record } = drawToolContext();
    draw(new DrawMode(context), [{ x: 50, y: 60 }]);
    expect(strokesIn(store)).toEqual([expect.objectContaining({ x: 50, y: 60, points: [0, 0] })]);
    expect(record.commands).toBe(1);
  });

  it('writes a stroke longer than one object stores as several objects in one command', () => {
    const { store, context, record } = drawToolContext();
    const points = Array.from({ length: MAX_FREEHAND_POINTS + 200 }, (unused, index) => ({
      x: index * 4,
      y: (index % 2) * 40,
    }));
    draw(new DrawMode(context), points);
    const strokes = strokesIn(store);
    expect(strokes.length).toBe(2);
    expect(record.commands).toBe(1);
    expect(strokes.every((stroke) => stroke.points.length / 2 <= MAX_FREEHAND_POINTS)).toBe(true);
    expect([...record.previews.values()].every((preview) => preview === undefined)).toBe(true);
    expect(record.previews.size).toBe(2);
  });

  it('keeps the marker’s pressure, and draws the next stroke in the same tool', () => {
    const { store, context } = drawToolContext({
      tool: 'marker',
      stroke: { color: [0, 0, 1, 1], width: 6 },
    });
    const mode = new DrawMode(context);
    draw(mode, CURVE, { pointerType: 'pen', pressure: 0.5 });
    draw(
      mode,
      [
        { x: 0, y: 0 },
        { x: 40, y: 40 },
      ],
      { pointerType: 'pen', pressure: 0.7 },
    );
    const strokes = strokesIn(store);
    expect(strokes).toHaveLength(2);
    expect(
      strokes.every((stroke) => stroke.tool === 'marker' && stroke.pressures !== undefined),
    ).toBe(true);
  });

  it('draws nothing for a finger once a pen was seen (palm rejection)', () => {
    const { store, context } = drawToolContext();
    const mode = new DrawMode(context);
    mode.onPointer(input('pointerMove', { x: 0, y: 0 }, { pointerType: 'pen' }));
    draw(
      mode,
      [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
      ],
      { pointerType: 'touch' },
    );
    expect(strokesIn(store)).toEqual([]);
  });

  it('drops the stroke without writing when the press is cancelled', () => {
    const { store, context, record } = drawToolContext();
    const mode = new DrawMode(context);
    const before = store.encodeState();
    mode.onPointer(input('pointerDown', { x: 0, y: 0 }));
    mode.onPointer(input('pointerMove', { x: 80, y: 20 }));
    mode.onPointer({ kind: 'pointerCancel' });
    mode.onPointer(input('pointerUp', { x: 80, y: 20 }));
    expect(store.encodeState()).toEqual(before);
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
    expect(record.commands).toBe(0);
  });

  it('drops the stroke on Escape, and leaves the tool on Escape with none', () => {
    const { store, context, record } = drawToolContext();
    const mode = new DrawMode(context);
    mode.onPointer(input('pointerDown', { x: 0, y: 0 }));
    mode.onPointer(input('pointerMove', { x: 80, y: 20 }));
    expect(mode.onKey({ kind: 'escape' })).toBe(true);
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
    expect(record.exitRequests).toBe(0);
    mode.onPointer(input('pointerUp', { x: 80, y: 20 }));
    expect(strokesIn(store)).toEqual([]);
    expect(mode.onKey({ kind: 'escape' })).toBe(true);
    expect(record.exitRequests).toBe(1);
    expect(mode.onKey({ kind: 'delete' })).toBe(false);
  });

  it('removes its preview when the tool is left mid-stroke, and shows no overlay', () => {
    const { context, record } = drawToolContext();
    const mode = new DrawMode(context);
    mode.onPointer(input('pointerDown', { x: 0, y: 0 }));
    mode.onPointer(input('pointerMove', { x: 80, y: 20 }));
    expect(mode.overlay()).toEqual({});
    mode.exit();
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
  });

  it('ignores a secondary click and a held finger', () => {
    const { context, record } = drawToolContext();
    const mode = new DrawMode(context);
    const at = input('pointerDown', { x: 0, y: 0 });
    expect(mode.onPointer({ ...at, kind: 'contextPress' }).isDone).toBe(false);
    expect(
      mode.onPointer({ kind: 'hold', timeStamp: 0, screen: { x: 0, y: 0 }, zoom: 1 }).isDone,
    ).toBe(false);
    expect(record.previews.size).toBe(0);
  });

  it('reports a refused command and writes nothing', () => {
    const { store, context, record } = drawToolContext({
      tool: 'pencil',
      stroke: { color: [0, 0, 0, 1], width: 0 },
    });
    draw(new DrawMode(context), [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ]);
    expect(strokesIn(store)).toEqual([]);
    expect(record.refusals).toHaveLength(1);
  });

  it('runs its command as it is without an undo capture', () => {
    const { store, context } = drawToolContext();
    const { capture, ...uncaptured } = context;
    expect(capture).toBeDefined();
    draw(new DrawMode(uncaptured), [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ]);
    expect(strokesIn(store)).toHaveLength(1);
  });

  it('resolves an ink stroke colour where the stroke starts', () => {
    const { store, context } = drawToolContext({
      tool: 'pencil',
      stroke: { color: 'ink', width: 2 },
    });
    draw(new DrawMode(context), [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ]);
    expect(strokesIn(store)[0]?.stroke.color).toBe('ink');
  });
});
