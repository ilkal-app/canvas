import { describe, expect, it } from 'vitest';

import { INK_COLORS, type ObjectId, type Rgba } from '@canvas/schema';

import { SDF_SHAPE_PASS, SDF_SHAPE_PASS_NAME } from '../shapes/shape-pass.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject, zKeyAt } from './__fixtures__/scene-objects.js';
import { SceneRenderer } from './scene-renderer.js';
import { Scene } from './scene.js';

const DARK: Rgba = INK_COLORS.dark;
const OUTLINE = 13;

/**
 * An ink-outlined shape, a black-outlined one and a plain one, applied to a scene.
 *
 * @returns The scene, its document and the shape pass's buffer.
 */
function setUp() {
  const scene = new Scene([SDF_SHAPE_PASS], { instanceBuffer: { maxGapBytes: 0 } });
  const document = new FakeSceneDocument();
  document.create(
    shapeObject('ink', { stroke: { color: 'ink', width: 2 }, z: zKeyAt(0) }),
    shapeObject('black', { stroke: { color: [0, 0, 0, 1], width: 2 }, z: zKeyAt(1) }),
    shapeObject('plain', { z: zKeyAt(2) }),
  );
  scene.apply(document.takeChanges());
  const buffer = scene.instanceBufferOf(SDF_SHAPE_PASS_NAME);
  const floats = SDF_SHAPE_PASS.layout.floatsPerRecord;
  const outlineOf = (id: string): number[] => {
    const [slot] = scene.slotsOf(id as ObjectId, SDF_SHAPE_PASS_NAME);
    const at = (slot ?? 0) * floats + OUTLINE;
    return Array.from(buffer.data.subarray(at, at + 4));
  };
  return { scene, document, buffer, outlineOf };
}

const f32 = (color: Rgba) => Array.from(new Float32Array(color));

describe('Scene ink', () => {
  it('writes ink in the scene’s colour, the light theme’s by default', () => {
    const { scene, outlineOf } = setUp();
    expect(scene.ink).toBe(INK_COLORS.light);
    expect(outlineOf('ink')).toEqual(f32(INK_COLORS.light));
    expect(outlineOf('black')).toEqual([0, 0, 0, 1]);
  });

  it('starts in the colour it is given', () => {
    const scene = new Scene([SDF_SHAPE_PASS], { ink: DARK });
    const document = new FakeSceneDocument();
    document.create(shapeObject('ink', { stroke: { color: 'ink', width: 2 } }));
    scene.apply(document.takeChanges());
    const data = scene.instanceBufferOf(SDF_SHAPE_PASS_NAME).data;
    expect(Array.from(data.subarray(OUTLINE, OUTLINE + 4))).toEqual(f32(DARK));
  });

  it('rewrites only the ink records on a switch, as one dirty range, reading no document', () => {
    const { scene, document, buffer, outlineOf } = setUp();
    buffer.clearDirty();
    const before = outlineOf('black');
    const read = document.get.bind(document);
    let reads = 0;
    document.get = (id) => {
      reads += 1;
      return read(id);
    };
    expect(scene.setInk(DARK)).toBe(1);
    expect(reads).toBe(0);
    expect(outlineOf('ink')).toEqual(f32(DARK));
    expect(outlineOf('black')).toEqual(before);
    const [slot] = scene.slotsOf('ink' as ObjectId, SDF_SHAPE_PASS_NAME);
    const stride = SDF_SHAPE_PASS.layout.byteStride;
    expect(buffer.dirtyRanges).toEqual([[(slot ?? 0) * stride, ((slot ?? 0) + 1) * stride]]);
  });

  it('does nothing for the same colour', () => {
    const { scene, buffer } = setUp();
    buffer.clearDirty();
    expect(scene.setInk([...INK_COLORS.light])).toBe(0);
    expect(buffer.dirtyRanges).toEqual([]);
  });

  it('forgets objects no longer drawn in ink, and deleted ones', () => {
    const { scene, document, outlineOf } = setUp();
    document.update('ink', { stroke: { color: [0, 0, 1, 1], width: 2 } });
    scene.apply(document.takeChanges());
    expect(scene.setInk(DARK)).toBe(0);
    expect(outlineOf('ink')).toEqual([0, 0, 1, 1]);
    document.update('black', { stroke: { color: 'ink', width: 2 } });
    scene.apply(document.takeChanges());
    expect(outlineOf('black')).toEqual(f32(DARK));
    document.delete('black');
    scene.apply(document.takeChanges());
    expect(scene.setInk(INK_COLORS.light)).toBe(0);
  });
});

describe('SceneRenderer.setTheme', () => {
  const camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 200, viewportHeightPx: 100, dpr: 1 };

  function renderer(options: ConstructorParameters<typeof SceneRenderer>[1] = {}) {
    const backend = new FakeGpuBackend();
    const scene = new SceneRenderer(backend, { passes: [SDF_SHAPE_PASS], ...options });
    const document = new FakeSceneDocument();
    document.create(
      shapeObject('ink', { stroke: { color: 'ink', width: 2 }, z: zKeyAt(0) }),
      ...Array.from({ length: 5 }, (ignored, index) =>
        shapeObject(`s${String(index)}`, { x: 20 * index, z: zKeyAt(index + 1) }),
      ),
    );
    scene.enqueue(document.takeChanges());
    scene.renderFrame({ timeMs: 0, camera });
    return { backend, scene };
  }

  it('uploads only the ink records on the next frame, then nothing', () => {
    const { backend, scene } = renderer();
    backend.resetCalls();
    expect(scene.setTheme('dark')).toBe(1);
    const stats = scene.renderFrame({ timeMs: 16, camera });
    expect(stats.uploadedBytes).toBe(SDF_SHAPE_PASS.layout.byteStride);
    expect(stats.bufferWrites).toBe(1);
    expect(scene.renderFrame({ timeMs: 32, camera }).uploadedBytes).toBe(0);
    expect(scene.setTheme('dark')).toBe(0);
  });

  it('starts in the given theme with the given ink colours, and changes them', () => {
    const custom = { light: [0.1, 0.1, 0.1, 1] as Rgba, dark: [0.8, 0.8, 0.8, 1] as Rgba };
    const { scene } = renderer({ theme: 'dark', inkColors: custom });
    expect(scene.scene.ink).toEqual(custom.dark);
    scene.setTheme('light');
    expect(scene.scene.ink).toEqual(custom.light);
    scene.setTheme('light', INK_COLORS);
    expect(scene.scene.ink).toBe(INK_COLORS.light);
  });
});
