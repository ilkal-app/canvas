import { describe, expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
  zKeyAt,
} from './__fixtures__/scene-objects.js';
import { BUILT_IN_STAGE_NAMES } from './built-in-stages.js';
import type { FrameContext } from './frame-context.js';
import { SceneRenderer } from './scene-renderer.js';

const STRIDE = FILLED_RECT_PASS.layout.byteStride;
const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 200, viewportHeightPx: 100, dpr: 1 };

function setUp(
  objectCount: number,
  initialCapacity = 16,
): {
  backend: FakeGpuBackend;
  renderer: SceneRenderer;
  document: FakeSceneDocument;
} {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: [FILLED_RECT_PASS],
    scene: { instanceBuffer: { initialCapacity, maxGapBytes: 0 } },
  });
  backend.resetCalls();
  const document = new FakeSceneDocument();
  for (let index = 0; index < objectCount; index += 1) {
    document.create(shapeObject(`s${String(index)}`, { x: index, z: zKeyAt(index) }));
  }
  renderer.enqueue(document.takeChanges());
  return { backend, renderer, document };
}

describe('SceneRenderer', () => {
  it('runs the built-in stages in order', () => {
    const { renderer } = setUp(0);
    expect(renderer.frame.stageNames).toEqual(BUILT_IN_STAGE_NAMES);
    expect(BUILT_IN_STAGE_NAMES).toEqual([
      'collectChanges',
      'levelOfDetail',
      'uploadDirtyRanges',
      'cull',
      'zOrderSegments',
      'layers',
      'draw',
      'submit',
    ]);
  });

  it('leaves z-order segments out when asked to', () => {
    const renderer = new SceneRenderer(new FakeGpuBackend(), { isZOrdered: false });
    // The default image-fill passes add the shared image stage after the level of
    // detail, whose changes it reads.
    expect(renderer.frame.stageNames).toEqual([
      'collectChanges',
      'levelOfDetail',
      'images',
      ...BUILT_IN_STAGE_NAMES.slice(2).filter((name) => name !== 'zOrderSegments'),
    ]);
  });

  it('uploads each pass geometry once, when it is created: by default solid rects, shapes and link images', () => {
    const backend = new FakeGpuBackend();
    new SceneRenderer(backend);
    // Each followed by its gradient variant and its image variant,
    // which draw nothing without one; the image variants create no texture manager until then.
    expect(backend.writes()).toEqual([
      { method: 'writeBuffer', label: 'solid-rect vertices', byteOffset: 0, byteLength: 48 },
      { method: 'writeBuffer', label: 'rect-gradient vertices', byteOffset: 0, byteLength: 48 },
      { method: 'writeBuffer', label: 'rect-image vertices', byteOffset: 0, byteLength: 48 },
      // Rounded frames' backgrounds wait for their first record: nothing yet.
      // A shape's quad carries four corner radii of 0 per vertex.
      { method: 'writeBuffer', label: 'sdf-shape vertices', byteOffset: 0, byteLength: 144 },
      {
        method: 'writeBuffer',
        label: 'sdf-shape-gradient vertices',
        byteOffset: 0,
        byteLength: 144,
      },
      { method: 'writeBuffer', label: 'sdf-shape-image vertices', byteOffset: 0, byteLength: 144 },
      // A link card's preview and icon take their corner radii from the record.
      { method: 'writeBuffer', label: 'link-preview vertices', byteOffset: 0, byteLength: 48 },
      { method: 'writeBuffer', label: 'link-icon vertices', byteOffset: 0, byteLength: 48 },
    ]);
    expect(backend.count('createRenderPipeline')).toBe(8);
    // The clip table, created zeroed: nothing written until a frame clips.
    expect(backend.calls.filter((call) => call.method === 'createTexture')).toEqual([
      { method: 'createTexture', label: 'clip-table', width: 64, height: 1 },
    ]);
    expect(backend.count('writeTexture')).toBe(0);
  });

  it('uploads the new records and the camera, then draws each pass once, on the first frame', () => {
    const { backend, renderer } = setUp(3);
    const stats = renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(backend.writes()).toEqual([
      { method: 'writeBuffer', label: 'camera', byteOffset: 0, byteLength: 32 },
      {
        method: 'writeBuffer',
        label: 'solid-rect instances',
        byteOffset: 0,
        byteLength: 3 * STRIDE,
      },
    ]);
    expect(backend.draws()).toEqual([
      { method: 'draw', vertexCount: 6, instanceCount: 3, firstVertex: 0, firstInstance: 0 },
    ]);
    expect(stats).toEqual({
      changedObjects: 3,
      bufferWrites: 2,
      uploadedBytes: 32 + 3 * STRIDE,
      drawCalls: 1,
      blankImages: 0,
      placeholderImages: 0,
      visibleImages: 0,
      segments: 1,
      carriedAdmissions: 0,
      lodTransitions: 0,
      lodThrashes: 0,
      atlasRegenerations: 0,
      atlasLookups: 0,
      atlasMisses: 0,
      meshRegenerations: 0,
      vectorTextRuns: 0,
      layersDrawn: 0,
      layersFallbackSmall: 0,
      layersFallbackLimit: 0,
      layersFallbackBudget: 0,
      layerBytes: 0,
      renderPasses: 1,
      pipelineSwitches: 1,
      bindGroupChanges: 1,
    });
    expect(backend.calls.at(-1)).toEqual({ method: 'submit' });
  });

  it('uploads nothing on a frame with no changes and the same camera', () => {
    const { backend, renderer } = setUp(100);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    backend.resetCalls();
    const stats = renderer.renderFrame({ timeMs: 16, camera: { ...CAMERA } });
    expect(backend.count('writeBuffer')).toBe(0);
    expect(backend.count('createBuffer')).toBe(0);
    expect(backend.count('draw')).toBe(1);
    expect(stats.uploadedBytes).toBe(0);
  });

  it('writes only the camera uniform on a camera-only frame', () => {
    const { backend, renderer } = setUp(100);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 16, camera: { ...CAMERA, x: 40, zoom: 2 } });
    expect(backend.writes()).toEqual([
      { method: 'writeBuffer', label: 'camera', byteOffset: 0, byteLength: 32 },
    ]);
  });

  it('uploads only the changed objects, in coalesced ranges', () => {
    const { backend, renderer, document } = setUp(100, 128);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    backend.resetCalls();
    for (const index of [10, 11, 12, 50]) document.update(`s${String(index)}`, { y: 7 });
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(backend.writes()).toEqual([
      {
        method: 'writeBuffer',
        label: 'solid-rect instances',
        byteOffset: 10 * STRIDE,
        byteLength: 3 * STRIDE,
      },
      {
        method: 'writeBuffer',
        label: 'solid-rect instances',
        byteOffset: 50 * STRIDE,
        byteLength: STRIDE,
      },
    ]);
  });

  it('applies the change sets queued between two frames once', () => {
    const { backend, renderer, document } = setUp(2);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    backend.resetCalls();
    document.update('s0', { x: 1 });
    renderer.enqueue(document.takeChanges());
    document.update('s0', { x: 2 });
    renderer.enqueue(document.takeChanges());
    const stats = renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(stats.changedObjects).toBe(1);
    expect(backend.count('writeBuffer')).toBe(1);
  });

  it('re-uploads a released record as zeros so a deleted object stops drawing', () => {
    const { backend, renderer, document } = setUp(3);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    backend.resetCalls();
    document.delete('s1');
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(backend.writes()).toEqual([
      {
        method: 'writeBuffer',
        label: 'solid-rect instances',
        byteOffset: STRIDE,
        byteLength: STRIDE,
      },
    ]);
    expect(backend.draws()[0]?.instanceCount).toBe(3);
  });

  it('replaces the GPU buffer when the instance buffer grows, uploading every record once', () => {
    const { backend, renderer, document } = setUp(2, 2);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    backend.resetCalls();
    document.create(frameObject('f'));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(backend.calls.filter((call) => call.method === 'createBuffer')).toEqual([
      { method: 'createBuffer', label: 'solid-rect instances', byteLength: 4 * STRIDE },
    ]);
    expect(backend.buffers.find((buffer) => buffer.byteLength === 2 * STRIDE)?.isDestroyed).toBe(
      true,
    );
    expect(backend.writes()).toEqual([
      {
        method: 'writeBuffer',
        label: 'solid-rect instances',
        byteOffset: 0,
        byteLength: 3 * STRIDE,
      },
    ]);
  });

  it('returns to dirty-range uploads on the frame after the buffer grew', () => {
    const { backend, renderer, document } = setUp(2, 2);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    document.create(frameObject('f'));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    backend.resetCalls();
    document.update('s1', { y: 9 });
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 32, camera: CAMERA });
    expect(backend.count('createBuffer')).toBe(0);
    expect(backend.writes()).toEqual([
      {
        method: 'writeBuffer',
        label: 'solid-rect instances',
        byteOffset: STRIDE,
        byteLength: STRIDE,
      },
    ]);
  });

  it('clears and submits an empty scene without drawing', () => {
    const { backend, renderer } = setUp(0);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(backend.count('beginRenderPass')).toBe(1);
    expect(backend.count('draw')).toBe(0);
    expect(backend.count('submit')).toBe(1);
  });

  it('gives an inserted stage the frame context, time and instance buffers included', () => {
    const { renderer } = setUp(5);
    const seen: { timeMs: number; frameIndex: number; records: number | undefined }[] = [];
    renderer.frame.insertStage('before', 'draw', {
      name: 'probe',
      run: (context: FrameContext) => {
        seen.push({
          timeMs: context.timeMs,
          frameIndex: context.frameIndex,
          records: context.instanceBuffers.get('solid-rect')?.recordCount,
        });
      },
    });
    renderer.renderFrame({ timeMs: 1000, camera: CAMERA });
    renderer.renderFrame({ timeMs: 1016, camera: CAMERA });
    expect(seen).toEqual([
      { timeMs: 1000, frameIndex: 0, records: 5 },
      { timeMs: 1016, frameIndex: 1, records: 5 },
    ]);
  });

  it('frees its GPU buffers when destroyed', () => {
    const { backend, renderer } = setUp(1);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    renderer.destroy();
    expect(backend.buffers.every((buffer) => buffer.isDestroyed)).toBe(true);
  });
});
