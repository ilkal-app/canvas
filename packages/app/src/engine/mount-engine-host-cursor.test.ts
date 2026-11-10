// @vitest-environment jsdom
// The select tool's cursor on the mounted canvas, turned toward its corner,
// set on the page whatever host draws the frames. In Chrome:
// tooling/scenario/specs/tools/select-rotation-band.spec.ts and select-rotate-cursor.spec.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountOnFakeHost } from './__fixtures__/fake-engine-host.js';
import { cssCursorOf, ROTATE_CURSOR_CSS } from './select-cursor-style.js';

/** Outside the first rectangle's bottom-right corner: the icon turned half round. */
const BOTTOM_RIGHT_BAND = cssCursorOf({ kind: 'rotate', angle: Math.PI });

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

// The demo board's first rectangle spans (50, 50)–(120, 110) on screen at 100%.
describe('createEngineHostMount: the select tool’s cursor', () => {
  it('turns the rotate cursor to match the corner it sits outside of', async () => {
    const { canvas, pointer } = await mountOnFakeHost();
    pointer('pointerdown', 60, 60);
    pointer('pointerup', 60, 60);
    const shown = [
      { x: 42, y: 42 },
      { x: 128, y: 42 },
      { x: 128, y: 118 },
      { x: 42, y: 118 },
    ].map((point) => {
      pointer('pointermove', point.x, point.y);
      return canvas.style.cursor;
    });
    expect(shown[0]).toBe(ROTATE_CURSOR_CSS);
    // A quarter turn apart, clockwise from the top-left, which shows the icon untouched.
    const quarters = [0, 1, 2, 3].map((quarter) =>
      cssCursorOf({ kind: 'rotate', angle: (quarter * Math.PI) / 2 }),
    );
    expect(shown).toEqual(quarters);
    expect(new Set(shown).size).toBe(4);
  });

  it('shows the rotate cursor over a selected object’s corner band, only with the select tool', async () => {
    const { canvas, engine, pointer } = await mountOnFakeHost();
    pointer('pointerdown', 60, 60);
    pointer('pointerup', 60, 60);
    pointer('pointermove', 128, 118);
    expect(canvas.style.cursor).toBe(BOTTOM_RIGHT_BAND);
    pointer('pointermove', 80, 80);
    expect(canvas.style.cursor).toBe('default');
    pointer('pointermove', 128, 118);
    // The connector tool's crosshair, never the rotate cursor.
    engine.setActiveTool('connector');
    expect(canvas.style.cursor).toBe('crosshair');
    pointer('pointermove', 129, 118);
    expect(canvas.style.cursor).toBe('crosshair');
  });

  it('follows a zoom under a still pointer', async () => {
    const { canvas, engine, pointer } = await mountOnFakeHost();
    pointer('pointerdown', 60, 60);
    pointer('pointerup', 60, 60);
    pointer('pointermove', 128, 118);
    expect(canvas.style.cursor).toBe(BOTTOM_RIGHT_BAND);
    // Zooming in about the viewport's centre carries the corner away from the pointer: five
    // levels of the zoom ladder, to 200%, and five back.
    for (let step = 0; step < 5; step += 1) {
      engine.runCanvasAction({ type: 'navigate', command: 'zoomIn' });
    }
    expect(engine.camera().zoom).toBeCloseTo(2, 9);
    expect(canvas.style.cursor).toBe('default');
    for (let step = 0; step < 5; step += 1) {
      engine.runCanvasAction({ type: 'navigate', command: 'zoomOut' });
    }
    expect(engine.camera().zoom).toBeCloseTo(1, 9);
    expect(canvas.style.cursor).toBe(BOTTOM_RIGHT_BAND);
  });

  it('follows an undo and a redo under a still pointer', async () => {
    const { canvas, engine, pointer } = await mountOnFakeHost();
    pointer('pointerdown', 60, 60);
    pointer('pointermove', 80, 70);
    pointer('pointerup', 90, 80);
    // Moved by (30, 20): the rectangle spans (80, 70)–(150, 130); rest outside that corner.
    pointer('pointermove', 158, 138);
    expect(canvas.style.cursor).toBe(BOTTOM_RIGHT_BAND);
    engine.runCanvasAction({ type: 'history', command: 'undo' });
    expect(engine.inspect().selectedObjects[0]).toMatchObject({ x: 10, y: 10 });
    expect(canvas.style.cursor).toBe('default');
    engine.runCanvasAction({ type: 'history', command: 'redo' });
    expect(canvas.style.cursor).toBe(BOTTOM_RIGHT_BAND);
  });
});
