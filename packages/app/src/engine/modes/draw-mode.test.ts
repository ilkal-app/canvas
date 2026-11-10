import { describe, expect, it } from 'vitest';

import { MAX_FREEHAND_POINTS, type FreehandObject } from '@canvas/schema';

import { onBoard, setUpTextDocument, TEXT_CAMERA } from '../__fixtures__/text-document.js';
import type { ScreenSample } from '../pointer-samples.js';

// The draw tool over the engine's document side, as the canvas drives it: screen px
// are world units at this camera. In Chrome: tooling/scenario/specs/tools/draw.spec.ts.

/**
 * The document side with the draw tool active and a stroke helper.
 *
 * @returns The fixture, a stroke helper and a reader of the board's strokes.
 */
function setUp() {
  const fixture = setUpTextDocument();
  const pointer = { isShiftPressed: false, isModPressed: false, timeStamp: 0 };
  const stroke = (points: readonly [number, number][], trail?: readonly ScreenSample[]) => {
    points.forEach(([x, y], index) => {
      const kind = index === 0 ? 'pointerDown' : 'pointerMove';
      const withTrail = index === 1 && trail !== undefined ? { trail } : {};
      fixture.document.handlePointer(
        { kind, screen: { x, y }, ...pointer, ...withTrail },
        TEXT_CAMERA,
      );
    });
    const [x, y] = points.at(-1) ?? [0, 0];
    fixture.document.handlePointer(
      { kind: 'pointerUp', screen: { x, y }, ...pointer },
      TEXT_CAMERA,
    );
  };
  const strokes = (): FreehandObject[] =>
    [...fixture.store.read().objects.values()].filter(
      (object): object is FreehandObject => object.type === 'freehand',
    );
  fixture.document.setActiveTool('draw');
  return { ...fixture, stroke, strokes };
}

describe('the draw tool on the document side', () => {
  it('draws a pencil stroke as one undo step and stays the active tool', () => {
    const { document, stroke, strokes, history, onToolChange, store } = setUp();
    expect(document.cursor()).toBe('crosshair');
    stroke(
      [
        [500, 520],
        [540, 560],
        [600, 540],
      ],
      [{ screen: { x: 520, y: 545 } }],
    );
    const [drawn, ...rest] = strokes();
    expect(rest).toEqual([]);
    // Drawn on a demo section, the stroke joins it (item 9): where it was drawn on the board.
    expect(drawn).toMatchObject({ tool: 'pencil', stroke: { width: 2 } });
    expect(onBoard(store, drawn)).toEqual([500, 520]);
    expect((drawn?.points.length ?? 0) / 2).toBeGreaterThanOrEqual(3);
    expect(document.inspect().selectedIds).toEqual([]);
    expect(onToolChange).not.toHaveBeenCalledWith('select');
    history.undo();
    expect(strokes()).toEqual([]);
  });

  it('undoes a stroke split past the per-object cap in one step', () => {
    const { stroke, strokes, history } = setUp();
    // A zigzag keeps every corner through simplification, so it splits at the cap.
    const zigzag = Array.from(
      { length: MAX_FREEHAND_POINTS + 76 },
      (unused, index): [number, number] => [100 + index * 2, 500 + (index % 2) * 40],
    );
    stroke(zigzag);
    expect(strokes().length).toBeGreaterThan(1);
    history.undo();
    expect(strokes()).toEqual([]);
  });

  it('draws the highlighter translucent and wide when the tool’s style picks it', () => {
    const { document, stroke, strokes } = setUp();
    document.panels.setToolStyle('draw', { tool: 'highlighter' });
    stroke([
      [500, 520],
      [600, 520],
    ]);
    expect(strokes()[0]).toMatchObject({
      tool: 'highlighter',
      opacity: 0.4,
      stroke: { width: 16 },
    });
  });

  it('erases the strokes a drag crosses with the eraser, as one undo step', () => {
    const { document, stroke, strokes, history, store } = setUp();
    for (const y of [500, 560, 620])
      stroke([
        [500, y],
        [600, y],
      ]);
    expect(strokes()).toHaveLength(3);
    const objects = store.read().objects.size;
    document.panels.setToolStyle('draw', { isEraser: true });
    stroke([
      [550, 470],
      [550, 530],
      [550, 590],
    ]);
    expect(strokes().map((drawn) => drawn.y)).toEqual([620]);
    // Ink only: the demo board's other objects under the path stay.
    expect(store.read().objects.size).toBe(objects - 2);
    history.undo();
    expect(strokes()).toHaveLength(3);
  });
});
