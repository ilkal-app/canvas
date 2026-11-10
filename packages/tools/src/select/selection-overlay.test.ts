import { describe, expect, it } from 'vitest';

import { SceneRenderer, SOLID_RECT_PASS, type Camera } from '@canvas/engine';

import { RecordingGpuBackend } from './__fixtures__/recording-gpu-backend.js';
import { MAX_LOCKED_DASHES } from './overlay-marks.js';
import { EMPTY_OVERLAY, overlayRectsOf, type SelectionOverlayModel } from './overlay-rects.js';
import { SELECTION_OVERLAY_STAGE_NAME, SelectionOverlay } from './selection-overlay.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 };

const FRAME = { x: 20, y: 20, width: 100, height: 60, rotation: 0 };
const MODEL: SelectionOverlayModel = { ...EMPTY_OVERLAY, frame: FRAME, canResize: true };

function setUp() {
  const backend = new RecordingGpuBackend();
  const renderer = new SceneRenderer(backend, { clearColor: [0, 0, 0, 0] });
  const overlay = new SelectionOverlay(backend);
  overlay.install(renderer.frame);
  const frame = (camera: Camera = CAMERA) => {
    backend.passes.length = 0;
    backend.writes.length = 0;
    renderer.renderFrame({ timeMs: 0, camera });
  };
  return { backend, renderer, overlay, frame };
}

describe('SelectionOverlay', () => {
  it('runs as a stage right after the scene is drawn and before submit', () => {
    const { renderer } = setUp();
    const names = renderer.frame.stageNames;
    expect(names.indexOf(SELECTION_OVERLAY_STAGE_NAME)).toBe(names.indexOf('draw') + 1);
    expect(names.at(-1)).toBe('submit');
  });

  it('draws nothing, in no pass of its own, while nothing is selected', () => {
    const { backend, overlay, frame } = setUp();
    frame();
    expect(backend.passes).toHaveLength(1);
    expect(overlay.rectCount).toBe(0);
  });

  it('writes nothing while nothing is selected, not even its camera, whatever the camera does', () => {
    const { backend, frame } = setUp();
    const overlayWrites = (): [string, number][] =>
      backend.writes.filter(([label]) => label.startsWith('selection-overlay'));
    // Only the scene's camera uniform (both are labelled `camera`) is written.
    const cameraWrites = (): number =>
      backend.writes.filter(([label]) => label === 'camera').length;
    frame();
    expect([overlayWrites(), cameraWrites()]).toEqual([[], 1]);
    frame({ ...CAMERA, x: 30, zoom: 2 });
    expect([overlayWrites(), cameraWrites()]).toEqual([[], 1]);
  });

  it('draws every rectangle of the model in one instanced draw over the cleared scene', () => {
    const { backend, overlay, frame } = setUp();
    overlay.setModel(MODEL);
    frame();
    const expected = overlayRectsOf(MODEL, 1).length;
    expect(overlay.rectCount).toBe(expected);
    expect(backend.passes).toHaveLength(2);
    expect(backend.passes[1]?.descriptor).toEqual({});
    expect(backend.passes[1]?.draws).toEqual([[6, expected, 0]]);
    expect(backend.passes[1]?.pipelines).toEqual(['selection-overlay']);
  });

  it('uploads nothing but the camera when only the camera pans, and rebuilds on a zoom', () => {
    const { backend, overlay, frame } = setUp();
    overlay.setModel(MODEL);
    frame();
    frame({ ...CAMERA, x: 10 });
    expect(backend.writes.filter(([label]) => label.startsWith('selection-overlay'))).toEqual([]);
    frame({ ...CAMERA, zoom: 2 });
    expect(backend.writes.some(([label]) => label === 'selection-overlay instances')).toBe(true);
  });

  it('rebuilds on a pan while a count badge shows, so the badge stays in view', () => {
    const { backend, overlay, frame } = setUp();
    overlay.setModel({ ...MODEL, countBadge: 600 });
    frame();
    const instanceWrites = (): number =>
      backend.writes.filter(([label]) => label === 'selection-overlay instances').length;
    frame();
    expect(instanceWrites()).toBe(0);
    // Panned so the frame's bottom leaves the view: the badge moves to stay in it.
    frame({ ...CAMERA, y: 40, viewportHeightPx: 60 });
    expect(instanceWrites()).toBeGreaterThan(0);
  });

  it('frees slots when the model shrinks and draws nothing once it is empty', () => {
    const { backend, overlay, frame } = setUp();
    overlay.setModel({ ...MODEL, outlines: [FRAME, FRAME] });
    frame();
    const many = overlay.rectCount;
    overlay.setModel(MODEL);
    frame();
    expect(overlay.rectCount).toBeLessThan(many);
    overlay.setModel(EMPTY_OVERLAY);
    frame();
    expect(overlay.rectCount).toBe(0);
    expect(backend.passes).toHaveLength(1);
  });

  it('keeps the rectangles in draw order when a selection comes back after an empty one', () => {
    const { backend, overlay, frame } = setUp();
    overlay.setModel(MODEL);
    frame();
    overlay.setModel(EMPTY_OVERLAY);
    frame();
    overlay.setModel(MODEL);
    frame();
    // Each handle's white inside must be drawn after (over) its blue square: the records' colours,
    // in slot order, are the rectangles' colours in draw order.
    const bytes = backend.contents.get('selection-overlay instances') ?? new Uint8Array(0);
    const floats = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    const { floatsPerRecord } = SOLID_RECT_PASS.layout;
    const rects = overlayRectsOf(MODEL, 1);
    const colours = rects.map((rect, slot) => [
      ...floats.subarray(slot * floatsPerRecord + 6, slot * floatsPerRecord + 10),
    ]);
    expect(colours).toEqual(rects.map(({ color }) => color.map((channel) => Math.fround(channel))));
  });

  it('frees its buffers on destroy', () => {
    const { backend, overlay } = setUp();
    overlay.destroy();
    expect(backend.destroyedBuffers).toEqual(
      expect.arrayContaining(['selection-overlay instances', 'selection-overlay vertices']),
    );
  });

  it('keeps a large locked frame’s dashes bounded at 32×, and a pan in the margin rebuilds nothing', () => {
    const { backend, overlay, frame } = setUp();
    const colour = [0.4, 0.4, 0.4, 1] as [number, number, number, number];
    const palette = { you: colour, guide: colour, hover: colour, locked: colour };
    const big = { x: 0, y: 0, width: 1000, height: 1000, rotation: 0 };
    overlay.setModel({ ...EMPTY_OVERLAY, frame: big, isLocked: true, palette });
    // 32×, a 1280 × 800 view on the frame's top-left corner: 40 × 25 world units.
    const deep: Camera = {
      x: -12,
      y: -10,
      zoom: 32,
      viewportWidthPx: 1280,
      viewportHeightPx: 800,
      dpr: 1,
    };
    frame(deep);
    // The dashes along the two edges crossing the window, and the lock badge's five rects.
    expect(overlay.rectCount).toBeGreaterThan(5);
    expect(overlay.rectCount).toBeLessThan(MAX_LOCKED_DASHES);
    expect(overlay.rectCount).toBeLessThan(600);
    // A pan of one world unit stays inside the window's margin: no overlay record is written.
    frame({ ...deep, x: -11 });
    const overlayWrites = backend.writes.filter(([label]) =>
      label.startsWith('selection-overlay instances'),
    );
    expect(overlayWrites).toEqual([]);
  });

  it('writes nothing through a pan and zoom with nothing selected, palette and all', () => {
    const { backend, overlay, frame } = setUp();
    const colour = [0.4, 0.4, 0.4, 1] as [number, number, number, number];
    const palette = { you: colour, guide: colour, hover: colour, locked: colour };
    // The model the shell sends at rest: nothing selected, its theme's palette on it.
    overlay.setModel({ ...EMPTY_OVERLAY, palette });
    let overlayWrites = 0;
    let passes = 0;
    for (let step = 0; step < 50; step += 1) {
      frame({ ...CAMERA, x: step * 7, zoom: 0.05 + step * 0.6 });
      overlayWrites += backend.writes.filter(([label]) =>
        label.startsWith('selection-overlay'),
      ).length;
      passes += backend.passes.length - 1;
    }
    expect([overlayWrites, passes, overlay.rectCount]).toEqual([0, 0, 0]);
  });
});
