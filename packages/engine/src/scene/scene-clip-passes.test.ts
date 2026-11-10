import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, Gradient, ObjectId, Shadow } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import { meshJob } from '../paths/mesh-job.js';
import {
  imageObject,
  lineObject,
  pathObject,
  stickyObject,
} from '../spatial/__fixtures__/spatial-objects.js';
import { WorkerPool } from '../workers/worker-pool.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, frameObject, shapeObject } from './__fixtures__/scene-objects.js';
import { CLIP_INDEX_LOCATION, LAYER_OPACITY_LOCATION } from './instance-layout.js';
import { LAYER_COMPOSITE_PASS_NAME } from './layers/layer-composite-pass-name.js';
import { SceneRenderer } from './scene-renderer.js';
import { createStandardScenePasses } from './standard-passes.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

const GRADIENT: Gradient = {
  type: 'radial',
  center: { x: 0.5, y: 0.5 },
  radius: 0.5,
  stops: [
    { offset: 0, color: [1, 1, 1, 1] },
    { offset: 1, color: [0, 0, 0, 0.5] },
  ],
};

const pools: WorkerPool[] = [];

afterEach(() => {
  for (const pool of pools.splice(0)) pool.terminate();
});

function standardRenderer(): SceneRenderer {
  const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: { mesh: meshJob } });
  pools.push(pool);
  return new SceneRenderer(new FakeGpuBackend(), {
    passes: createStandardScenePasses({ jobs: pool }),
    isZOrdered: false,
  });
}

// Every record's clip index, by pass and owner.
function clipIndices(renderer: SceneRenderer): Record<string, Record<string, number[]>> {
  const result: Record<string, Record<string, number[]>> = {};
  for (const pass of renderer.scene.passes) {
    const buffer = renderer.scene.instanceBufferOf(pass.name);
    const { floatsPerRecord, clipFloat = -1 } = buffer.layout;
    const byOwner: Record<string, number[]> = {};
    for (const [owner, slots] of renderer.scene.slotEntriesOf(pass.name)) {
      byOwner[owner] = slots.map((slot) => buffer.data[slot * floatsPerRecord + clipFloat] ?? -1);
    }
    result[pass.name] = byOwner;
  }
  return result;
}

describe('the clip index in every standard pass', () => {
  it('ends every standard pass record with the clip index at location 14, then the transparency', () => {
    for (const pass of standardRenderer().scene.passes) {
      // The composite's record holds its opacity alone: its drawer reads it, no shader does.
      if (pass.name === LAYER_COMPOSITE_PASS_NAME) continue;
      const { layout } = pass;
      expect(layout.clipFloat, pass.name).toBe(layout.floatsPerRecord - 2);
      expect(layout.opacityFloat, pass.name).toBe(layout.floatsPerRecord - 1);
      expect(layout.vertexBufferLayout.attributes.slice(-2), pass.name).toEqual([
        { location: CLIP_INDEX_LOCATION, format: 'float32' },
        { location: LAYER_OPACITY_LOCATION, format: 'float32' },
      ]);
    }
  });

  it('writes the nearest clipping ancestor’s slot into each child record, in every pass', () => {
    const renderer = standardRenderer();
    const document = new FakeSceneDocument();
    // Drop shadows: a child's is cut by the clip like the child; the clipping
    // frame's own is not.
    const shadow: Shadow = { x: 4, y: 4, blur: 8, spread: 0, color: [0, 0, 0, 0.3] };
    const children: BoardObject[] = [
      frameObject('solid', { parentId: 'clip', clip: false, shadow }),
      frameObject('gradient', { parentId: 'clip', background: GRADIENT }),
      shapeObject('shape', { parentId: 'clip', shadow }),
      shapeObject('gradient-shape', { parentId: 'clip', fill: GRADIENT, shadow }),
      stickyObject('note', { parentId: 'clip' }),
      { ...imageObject('photo'), parentId: 'clip' as ObjectId },
      lineObject('line', { parentId: 'clip' }),
      pathObject(
        'path',
        [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 0, y: 50 },
        ],
        { isClosed: true },
        { parentId: 'clip', fill: GRADIENT },
      ),
    ];
    document.create(
      frameObject('clip', { clip: true, width: 400, height: 300, shadow }),
      ...children,
    );
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    const slot = renderer.scene.clipTable.slotOf('clip' as ObjectId);
    expect(slot).toBeGreaterThan(0);
    const indices = clipIndices(renderer);
    const drawn = new Set<string>();
    for (const [passName, byOwner] of Object.entries(indices)) {
      for (const [owner, records] of Object.entries(byOwner)) {
        drawn.add(passName);
        const expected = owner === 'clip' ? 0 : slot;
        expect(records, `${passName} ${owner}`).toEqual(records.map(() => expected));
      }
    }
    expect(indices['frame-shadow']).toEqual({ clip: [0], solid: [slot] });
    expect(indices['sdf-shape']?.shape).toEqual([slot, slot]);
    expect(indices['sdf-shape']?.['gradient-shape']).toEqual([slot]);
    expect([...drawn].sort()).toEqual(
      [
        'frame-shadow',
        'solid-rect',
        'rect-gradient',
        'sdf-shape',
        'sdf-shape-gradient',
        'image',
        'path',
        'path-gradient',
      ].sort(),
    );
  });

  it('binds the clip table at binding 5 in every bind group, and rebinds when it grows', () => {
    const backend = new FakeGpuBackend();
    const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: { mesh: meshJob } });
    pools.push(pool);
    const renderer = new SceneRenderer(backend, {
      passes: createStandardScenePasses({ jobs: pool }),
      isZOrdered: false,
    });
    const groups = vi.spyOn(backend, 'createBindGroup');
    const document = new FakeSceneDocument();
    const frames = Array.from({ length: 20 }, (unused, index) =>
      frameObject(`f${String(index)}`, { x: index * 30, clip: true, width: 20, height: 20 }),
    );
    document.create(
      ...frames,
      ...frames.map((frame) => shapeObject(`s${frame.id}`, { parentId: frame.id })),
      shapeObject('gradient', { parentId: 'f0', fill: GRADIENT }),
    );
    renderer.enqueue(document.takeChanges());
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    // The table grew past its first 16 slots before the first upload: one texture, written once.
    const live = backend.liveTextures().filter((texture) => texture.label === 'clip-table');
    expect(live).toHaveLength(1);
    expect(backend.calls.filter((call) => 'label' in call && call.label === 'clip-table')).toEqual([
      { method: 'createTexture', label: 'clip-table', width: 128, height: 1 },
      { method: 'writeTexture', label: 'clip-table', byteLength: 21 * 4 * 16 },
    ]);
    expect(groups).toHaveBeenCalled();
    for (const [descriptor] of groups.mock.calls) {
      expect(descriptor.entries).toContainEqual({ binding: 5, texture: live[0] });
    }
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(backend.calls.filter((call) => 'label' in call && call.label === 'clip-table')).toEqual(
      [],
    );
    // Twenty more clipping frames outgrow the texture: every pass rebinds the new one.
    const more = Array.from({ length: 20 }, (unused, index) =>
      frameObject(`g${String(index)}`, { y: 100, x: index * 30, clip: true, width: 20 }),
    );
    document.create(
      ...more,
      ...more.map((frame) => shapeObject(`s${frame.id}`, { parentId: frame.id })),
    );
    renderer.enqueue(document.takeChanges());
    groups.mockClear();
    renderer.renderFrame({ timeMs: 32, camera: CAMERA });
    const [grown] = backend.liveTextures().filter((texture) => texture.label === 'clip-table');
    expect(grown).not.toBe(live[0]);
    expect(groups).toHaveBeenCalled();
    for (const [descriptor] of groups.mock.calls) {
      expect(descriptor.entries).toContainEqual({ binding: 5, texture: grown });
    }
    renderer.destroy();
    expect(backend.liveTextures().filter((texture) => texture.label === 'clip-table')).toEqual([]);
  });
});
