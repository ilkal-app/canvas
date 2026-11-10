import { describe, expect, it } from 'vitest';

import { SceneRenderer } from '@canvas/engine';

import { RecordingGpuBackend } from './__fixtures__/recording-gpu-backend.js';
import { EMPTY_OVERLAY } from './overlay-rects.js';
import { createSelectionOverlayLayer, isSelectionOverlayModel } from './selection-overlay-layer.js';
import { SELECTION_OVERLAY_STAGE_NAME } from './selection-overlay.js';

const BOX = { x: 10, y: 20, width: 30, height: 40, rotation: 0.5 };
const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

describe('isSelectionOverlayModel', () => {
  it('accepts the models the select tool makes, as they arrive structured-cloned', () => {
    expect(isSelectionOverlayModel(structuredClone(EMPTY_OVERLAY))).toBe(true);
    const selection = {
      frame: BOX,
      outlines: [BOX, BOX],
      canResize: true,
      isLocked: false,
      marquee: undefined,
    };
    expect(isSelectionOverlayModel(structuredClone(selection))).toBe(true);
    const marquee = { ...EMPTY_OVERLAY, marquee: { minX: 0, minY: 0, maxX: 5, maxY: 5 } };
    expect(isSelectionOverlayModel(structuredClone(marquee))).toBe(true);
    const dropping = { ...selection, dropTarget: BOX };
    expect(isSelectionOverlayModel(structuredClone(dropping))).toBe(true);
    const capped = { ...EMPTY_OVERLAY, frame: BOX, countBadge: 50_000 };
    expect(isSelectionOverlayModel(structuredClone(capped))).toBe(true);
    const entered = { ...selection, enteredGroup: BOX };
    expect(isSelectionOverlayModel(structuredClone(entered))).toBe(true);
    const caret = { box: BOX, color: [0, 0, 1, 1] };
    const editing = { ...EMPTY_OVERLAY, toolRects: [caret] };
    expect(isSelectionOverlayModel(structuredClone(editing))).toBe(true);
    const snapping = { ...selection, guides: [{ axis: 'y', position: 5, from: 0, to: 9 }] };
    expect(isSelectionOverlayModel(structuredClone(snapping))).toBe(true);
  });

  it('accepts the editing states’ hover, gap runs, palette and labels', () => {
    const colour = [0.5, 0.5, 0.5, 1];
    const states = {
      ...EMPTY_OVERLAY,
      frame: BOX,
      hover: BOX,
      gaps: [{ axis: 'x', from: 0, to: 24, position: 5 }],
      palette: { you: colour, guide: colour, hover: colour, locked: colour },
      labels: [
        { kind: 'size', text: '30 × 40', at: { x: 40, y: 60 } },
        { kind: 'gap', text: '24', at: { x: 12, y: 5 }, axis: 'x' },
        { kind: 'locked', text: 'Locked', at: { x: 10, y: 60 } },
        { kind: 'extent', text: '30 × 40', at: { x: 25, y: 60 } },
        { kind: 'connect', text: 'Release to connect', at: { x: 40, y: 40 } },
      ],
    };
    expect(isSelectionOverlayModel(structuredClone(states))).toBe(true);
  });

  it('refuses malformed editing states', () => {
    const colour = [0.5, 0.5, 0.5, 1];
    for (const value of [
      { ...EMPTY_OVERLAY, hover: 'rect-a' },
      { ...EMPTY_OVERLAY, gaps: [{ axis: 'x', from: 0, to: Number.NaN, position: 5 }] },
      { ...EMPTY_OVERLAY, gaps: 'gap' },
      { ...EMPTY_OVERLAY, palette: { you: colour, guide: colour, hover: colour } },
      { ...EMPTY_OVERLAY, palette: { you: colour, guide: colour, hover: colour, locked: [1] } },
      { ...EMPTY_OVERLAY, labels: [{ kind: 'shout', text: 'Hi', at: { x: 0, y: 0 } }] },
      { ...EMPTY_OVERLAY, labels: [{ kind: 'size', text: 4, at: { x: 0, y: 0 } }] },
      { ...EMPTY_OVERLAY, labels: [{ kind: 'gap', text: '4', at: { x: 0 } }] },
      { ...EMPTY_OVERLAY, labels: [{ kind: 'gap', text: '4', at: { x: 0, y: 0 }, axis: 'z' }] },
    ]) {
      expect(isSelectionOverlayModel(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('refuses anything else', () => {
    for (const value of [
      undefined,
      'frame',
      { ...EMPTY_OVERLAY, outlines: undefined },
      { ...EMPTY_OVERLAY, canResize: 'yes' },
      { ...EMPTY_OVERLAY, isLocked: undefined },
      { ...EMPTY_OVERLAY, frame: { ...BOX, rotation: Number.NaN } },
      { ...EMPTY_OVERLAY, outlines: [{ x: 1 }] },
      { ...EMPTY_OVERLAY, marquee: { minX: 0, minY: 0, maxX: 5 } },
      { ...EMPTY_OVERLAY, dropTarget: { ...BOX, x: Number.POSITIVE_INFINITY } },
      { ...EMPTY_OVERLAY, dropTarget: 'frame-1' },
      { ...EMPTY_OVERLAY, countBadge: 0 },
      { ...EMPTY_OVERLAY, countBadge: 2.5 },
      { ...EMPTY_OVERLAY, countBadge: '600' },
      { ...EMPTY_OVERLAY, enteredGroup: { ...BOX, width: Number.NaN } },
      { ...EMPTY_OVERLAY, toolRects: 'caret' },
      { ...EMPTY_OVERLAY, toolRects: [{ box: BOX, color: [0, 0, 1] }] },
      {
        ...EMPTY_OVERLAY,
        toolRects: [{ box: { ...BOX, width: Number.NaN }, color: [0, 0, 0, 1] }],
      },
      { ...EMPTY_OVERLAY, guides: 'x' },
      { ...EMPTY_OVERLAY, guides: [{ axis: 'z', position: 5, from: 0, to: 9 }] },
      { ...EMPTY_OVERLAY, guides: [{ axis: 'x', position: 5, from: 0 }] },
    ]) {
      expect(isSelectionOverlayModel(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe('createSelectionOverlayLayer', () => {
  it("installs the select tool's overlay after the scene and draws the models it accepts", () => {
    const backend = new RecordingGpuBackend();
    const renderer = new SceneRenderer(backend);
    const layer = createSelectionOverlayLayer(backend);
    layer.install(renderer.frame);
    expect(renderer.frame.stageNames).toContain(SELECTION_OVERLAY_STAGE_NAME);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(backend.passes).toHaveLength(1);
    expect(layer.setModel({ ...EMPTY_OVERLAY, frame: BOX, canResize: true })).toBe(true);
    expect(layer.setModel({ frame: 'box' })).toBe(false);
    backend.passes.length = 0;
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(backend.passes[1]?.pipelines).toEqual(['selection-overlay']);
    layer.destroy();
    expect(backend.destroyedBuffers).toContain('selection-overlay instances');
  });
});
