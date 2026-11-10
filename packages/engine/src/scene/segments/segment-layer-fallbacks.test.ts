import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { SDF_SHAPE_PASS } from '../../shapes/shape-pass.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from '../__fixtures__/scene-objects.js';
import { LAYER_COMPOSITE_PASS } from '../layers/layer-composite-pass.js';
import type { ScenePass } from '../scene-pass.js';
import { SceneRenderer } from '../scene-renderer.js';
import { SOLID_RECT_PASS } from '../solid-rect-pass.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 };

function setUp(composite: ScenePass = LAYER_COMPOSITE_PASS) {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: [SOLID_RECT_PASS, composite, SDF_SHAPE_PASS],
  });
  const document = new FakeSceneDocument();
  let time = 0;
  const frame = (zoom = 1) => {
    renderer.enqueue(document.takeChanges());
    backend.resetCalls();
    return renderer.renderFrame({ timeMs: (time += 16), camera: { ...CAMERA, zoom } });
  };
  const transparencyOf = (name: string): number | undefined => {
    const [slot] = renderer.scene.slotsOf(name as ObjectId, 'sdf-shape');
    const pass = renderer.scene.passes.find(({ name: pass }) => pass === 'sdf-shape');
    const floats = pass?.layout.floatsPerRecord ?? 0;
    const at = pass?.layout.opacityFloat ?? 0;
    return slot === undefined
      ? undefined
      : renderer.scene.instanceBufferOf('sdf-shape').data[slot * floats + at];
  };
  const targetPasses = (): number =>
    backend.calls.filter((call) => call.method === 'beginRenderPass' && call.target).length;
  return { backend, renderer, document, frame, transparencyOf, targetPasses };
}

describe('layer fallbacks in the z-order segments', () => {
  it('rewrites and uploads a fallen-back subtree, and composites it again unchanged', () => {
    const { backend, document, frame, transparencyOf, targetPasses } = setUp();
    document.create(
      frameObject('outer', { width: 300, height: 200, opacity: 0.5 }),
      groupObject('inner', { parentId: 'outer', opacity: 0.5 }),
      shapeObject('child', { parentId: 'inner', width: 100, height: 100, opacity: 0.8 }),
    );
    frame();
    expect(targetPasses()).toBe(2);
    expect(transparencyOf('child')).toBeCloseTo(0.2);
    const stats = frame(0.5);
    // The 50 px group falls back into the frame's window; the 150 px frame still composites.
    expect(stats).toMatchObject({ layersDrawn: 1, layersFallbackSmall: 1 });
    expect(targetPasses()).toBe(1);
    expect(transparencyOf('child')).toBeCloseTo(0.6);
    expect(backend.writes().some(({ label }) => label === 'sdf-shape instances')).toBe(true);
    frame(0.5);
    expect(backend.writes().some(({ label }) => label === 'sdf-shape instances')).toBe(false);
    frame(1);
    expect(targetPasses()).toBe(2);
    expect(transparencyOf('child')).toBeCloseTo(0.2);
    // Both fall back in one frame: the inner group is rewritten once, under the frame.
    expect(frame(0.15)).toMatchObject({ layersDrawn: 0, layersFallbackSmall: 2 });
    expect(transparencyOf('child')).toBeCloseTo(0.8);
  });

  it('swaps one fallback for another in a single frame', () => {
    const { document, frame, transparencyOf, targetPasses } = setUp();
    document.create(
      groupObject('a', { opacity: 0.5 }),
      shapeObject('a-child', { parentId: 'a', width: 30, height: 30 }),
      groupObject('b', { opacity: 0.5 }),
      shapeObject('b-child', { parentId: 'b', x: 200, width: 100, height: 100 }),
    );
    frame();
    expect(transparencyOf('a-child')).toBeCloseTo(0.5);
    expect(transparencyOf('b-child')).toBe(0);
    document.update('a-child', { width: 120, height: 120 });
    document.update('b-child', { width: 30, height: 30 });
    expect(frame()).toMatchObject({ layersDrawn: 1, layersFallbackSmall: 1 });
    expect(targetPasses()).toBe(1);
    expect(transparencyOf('a-child')).toBe(0);
    expect(transparencyOf('b-child')).toBeCloseTo(0.5);
  });

  it('clears the fallbacks when the last layer goes, and multiplies its opacity no more', () => {
    const { document, frame, transparencyOf, targetPasses } = setUp();
    document.create(
      groupObject('tiny', { opacity: 0.5 }),
      shapeObject('child', { parentId: 'tiny', width: 30, height: 30 }),
    );
    expect(frame()).toMatchObject({ layersFallbackSmall: 1, layersDrawn: 0 });
    expect(transparencyOf('child')).toBeCloseTo(0.5);
    document.update('tiny', { opacity: 1 });
    expect(frame()).toMatchObject({ layersFallbackSmall: 0 });
    expect(transparencyOf('child')).toBe(0);
    document.update('tiny', { opacity: 0.5 });
    document.update('child', { width: 120, height: 120 });
    frame();
    expect(targetPasses()).toBe(1);
    expect(transparencyOf('child')).toBe(0);
  });

  it('plans every layer without a compositor to choose, counting no fallback', () => {
    const plain: ScenePass = { ...LAYER_COMPOSITE_PASS };
    delete plain.createDrawer;
    const { document, frame } = setUp(plain);
    document.create(
      groupObject('tiny', { opacity: 0.5 }),
      shapeObject('child', { parentId: 'tiny', width: 30, height: 30 }),
    );
    expect(frame()).toMatchObject({ layersFallbackSmall: 0, layersDrawn: 0 });
    // A move under the plan: its layers are measured by the plan itself.
    document.update('child', { x: 40 });
    expect(frame()).toMatchObject({ layersFallbackSmall: 0 });
  });
});
