import { describe, expect, it } from 'vitest';

import { DRAFT_PREVIEW_Z, type FreehandObject } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import { zKeyAt } from '../scene/__fixtures__/scene-objects.js';

import { createPathScene, PATH_CAMERA, squarePath, zigzagPath } from './__fixtures__/path-scene.js';
import { FRESH_STROKE_SEGMENTS, INLINE_MESH_SEGMENTS_PER_FRAME } from './inline-mesh.js';
import type { MeshJobRequest, MeshJobResponse } from './mesh-job-payload.js';
import { runMeshJob } from './mesh-job.js';
import type { PathMeshBuilder } from './path-mesh-builder.js';

const atZoom = (zoom: number): Camera => ({ ...PATH_CAMERA, zoom });

/**
 * A pencil stroke of some points along a wave, as the draw tool previews it.
 *
 * @param id - The object id.
 * @param points - How many points.
 * @param index - Its place in the stack, bottom first.
 * @returns The stroke.
 */
function stroke(id: string, points: number, index = 0): FreehandObject {
  const flat: number[] = [];
  for (let index = 0; index < points; index += 1) flat.push(index * 4, Math.sin(index / 3) * 10);
  return {
    id,
    type: 'freehand',
    parentId: null,
    x: 10,
    y: 40,
    rotation: 0,
    z: zKeyAt(index),
    locked: false,
    createdBy: 'user:ada',
    createdAt: 0,
    updatedAt: 0,
    tool: 'pencil',
    points: flat,
    stroke: { color: [0, 0, 0, 1], width: 4 },
  } as FreehandObject;
}

const meshBuffers = (scene: ReturnType<typeof createPathScene>) =>
  scene.backend.buffers.filter(({ label }) => label === 'path mesh');

/** A builder whose meshes land when a test says so. */
class DeferredBuilder implements PathMeshBuilder {
  readonly requests: MeshJobRequest[] = [];
  private readonly settles: {
    resolve: (response: MeshJobResponse) => void;
    reject: (error: Error) => void;
    request: MeshJobRequest;
  }[] = [];

  build(request: MeshJobRequest): Promise<MeshJobResponse> {
    this.requests.push(request);
    return new Promise((resolve, reject) => {
      this.settles.push({ resolve, reject, request });
    });
  }

  async landAll(): Promise<void> {
    for (const { resolve, request } of this.settles.splice(0)) resolve(runMeshJob(request));
    await Promise.resolve();
  }

  async failAll(): Promise<void> {
    for (const { reject } of this.settles.splice(0)) reject(new Error('worker crashed'));
    await Promise.resolve();
  }
}

describe('PathDrawer meshes', () => {
  it('builds nothing and uploads only the camera on a pan within the bucket', () => {
    const scene = createPathScene();
    scene.document.create(squarePath('p', 0));
    scene.frame();
    scene.backend.resetCalls();
    scene.frame({ ...PATH_CAMERA, x: 5 });
    expect(scene.reports.at(-1)).toMatchObject({ meshesBuilt: 0, pathsDrawn: 1 });
    expect(scene.backend.writes().map(({ label }) => label)).toEqual(['camera']);
    expect(scene.renderer.hasPendingWork()).toBe(false);
  });

  it('rebuilds after the zoom crosses a bucket boundary by the margin, not before', () => {
    // A buffer per mesh, to count the meshes.
    const scene = createPathScene({ meshPageBytes: 0 });
    scene.document.create(zigzagPath('z', 0));
    scene.frame(atZoom(1));
    scene.frame(atZoom(2 ** (0.7 / 2)));
    expect(scene.reports.at(-1)).toMatchObject({ bucket: 0, meshesBuilt: 0 });
    scene.frame(atZoom(2 ** (0.8 / 2)));
    expect(scene.reports.at(-1)).toMatchObject({ bucket: 1, meshesBuilt: 1 });
    // Back to bucket 0: its mesh is still cached.
    scene.frame(atZoom(1));
    expect(scene.reports.at(-1)).toMatchObject({ bucket: 0, meshesBuilt: 0 });
    expect(meshBuffers(scene)).toHaveLength(2);
  });

  it('flattens for device pixels: dpr 2 at zoom 1 is the bucket of zoom 2', () => {
    const scene = createPathScene();
    scene.document.create(zigzagPath('z', 0));
    scene.frame({ ...PATH_CAMERA, dpr: 2 });
    expect(scene.reports.at(-1)?.bucket).toBe(2);
  });

  it('keeps the mesh through a move and a recolour, and rebuilds after an edit', () => {
    const scene = createPathScene();
    scene.document.create(squarePath('p', 0));
    scene.frame();
    scene.document.update('p', { x: 50, fill: [1, 0, 0, 1] });
    scene.frame();
    expect(scene.reports.at(-1)?.meshesBuilt).toBe(0);
    const [edited] = [
      squarePath('p', 0).vertices.map((vertex) => ({ ...vertex, x: vertex.x * 2 })),
    ];
    scene.document.update('p', { vertices: edited });
    scene.frame();
    expect(scene.reports.at(-1)?.meshesBuilt).toBe(1);
    // The old version's mesh is dropped once the new one is cached.
    expect(meshBuffers(scene).filter(({ isDestroyed }) => !isDestroyed)).toHaveLength(1);
  });

  it('frees the meshes of a deleted path and of one that stops drawing', () => {
    const scene = createPathScene();
    scene.document.create(squarePath('p', 0), zigzagPath('z', 1));
    scene.frame();
    expect(scene.meshBytes()).toBeGreaterThan(0);
    scene.document.delete('p');
    scene.document.update('z', { stroke: null });
    scene.backend.resetCalls();
    scene.frame();
    expect(meshBuffers(scene).every(({ isDestroyed }) => isDestroyed)).toBe(true);
    expect(scene.meshBytes()).toBe(0);
    expect(scene.backend.draws()).toHaveLength(0);
  });

  it('reports the cached bytes to the memory ledger under meshes', () => {
    const scene = createPathScene({ meshPageBytes: 0 });
    scene.document.create(squarePath('p', 0));
    scene.frame();
    const [buffer] = meshBuffers(scene);
    expect(scene.meshBytes()).toBe(buffer?.byteLength);
    expect(scene.reports.at(-1)?.meshBytes).toBe(buffer?.byteLength);
  });

  it('reports the shared pages to the memory ledger, free room included', () => {
    const scene = createPathScene();
    scene.document.create(squarePath('p', 0), zigzagPath('z', 1));
    scene.frame();
    const [page] = meshBuffers(scene);
    expect(meshBuffers(scene)).toHaveLength(1);
    expect(scene.meshBytes()).toBe(page?.byteLength);
    expect(scene.reports.at(-1)?.meshBytes).toBeLessThan(page?.byteLength ?? 0);
  });

  it('evicts off-screen meshes first when over the byte budget', () => {
    const scene = createPathScene({ meshByteBudget: 1, meshPageBytes: 0 });
    scene.document.create(squarePath('a', 0), squarePath('b', 1, { x: 200 }));
    scene.frame();
    // Both are on screen: over budget, nothing evicted.
    expect(scene.reports.at(-1)?.evictions).toBe(0);
    scene.frame({ ...PATH_CAMERA, x: 150 });
    const [a, b] = meshBuffers(scene);
    expect(a?.isDestroyed).toBe(true);
    expect(b?.isDestroyed).toBe(false);
    expect(scene.reports.at(-1)?.evictions).toBe(1);
  });

  it('spreads meshing over frames under the per-frame budget, drawing stand-ins meanwhile', () => {
    const scene = createPathScene({ maxMeshSegmentsPerFrame: 4 });
    scene.document.create(
      zigzagPath('a', 0),
      zigzagPath('b', 1, { y: 50 }),
      zigzagPath('c', 2, { y: 100 }),
    );
    scene.frame();
    expect(scene.reports.at(-1)).toMatchObject({ meshesBuilt: 2, pathsDrawn: 2 });
    expect(scene.renderer.hasPendingWork()).toBe(true);
    scene.frame();
    expect(scene.reports.at(-1)).toMatchObject({ meshesBuilt: 1, pathsDrawn: 3 });
    expect(scene.renderer.hasPendingWork()).toBe(false);
    // A zoom into the next bucket: two rebuild, the third draws its old mesh.
    scene.frame(atZoom(2));
    expect(scene.reports.at(-1)).toMatchObject({ meshesBuilt: 2, standIns: 1, pathsDrawn: 3 });
  });

  it('always sends at least one path, however large', () => {
    const scene = createPathScene({ maxMeshSegmentsPerFrame: 1 });
    scene.document.create(zigzagPath('a', 0));
    scene.frame();
    expect(scene.reports.at(-1)?.meshesBuilt).toBe(1);
  });
});

describe('PathDrawer with a deferred builder', () => {
  it('draws once the built mesh lands, and asks for frames while it waits', async () => {
    const builder = new DeferredBuilder();
    const scene = createPathScene({ meshBuilder: builder });
    scene.document.create(squarePath('p', 0));
    scene.frame();
    expect(scene.reports.at(-1)).toMatchObject({ pathsDrawn: 0, pendingMeshes: 1 });
    expect(scene.renderer.hasPendingWork()).toBe(true);
    // Asked again before it lands, it is not sent twice.
    scene.frame();
    expect(builder.requests).toHaveLength(1);
    await builder.landAll();
    expect(scene.renderer.hasPendingWork()).toBe(false);
    scene.frame();
    expect(scene.reports.at(-1)).toMatchObject({ pathsDrawn: 1, meshesBuilt: 0 });
    expect(scene.backend.draws()).not.toHaveLength(0);
  });

  it('draws the old version while an edit is meshed', async () => {
    const builder = new DeferredBuilder();
    const scene = createPathScene({ meshBuilder: builder });
    scene.document.create(squarePath('p', 0));
    scene.frame();
    await builder.landAll();
    scene.document.update('p', { stroke: { color: [0, 0, 0, 1], width: 6 } });
    scene.frame();
    expect(scene.reports.at(-1)).toMatchObject({ pathsDrawn: 1, standIns: 1 });
  });

  it('meshes a stroke just begun in its first frame, not through the builder', () => {
    const builder = new DeferredBuilder();
    const scene = createPathScene({ meshBuilder: builder });
    scene.document.create(stroke('ink', 3));
    scene.frame();
    expect(builder.requests).toHaveLength(0);
    expect(scene.reports.at(-1)).toMatchObject({ pathsDrawn: 1, meshesBuilt: 1, standIns: 0 });
  });

  it.each(['a zoom', 'many strokes changed at once'] as const)(
    'meshes the live stroke in the frame though %s spends the shared budget first',
    async (competitor) => {
      const builder = new DeferredBuilder();
      // A budget the competitors' rebuilds exceed on their own.
      const scene = createPathScene({ meshBuilder: builder, maxMeshSegmentsPerFrame: 40 });
      const others = [1, 2, 3, 4].map((index) => stroke(`other-${String(index)}`, 300, index));
      // The pen's stroke is the draw tool's preview, on the draft key.
      scene.document.create(...others, { ...stroke('ink', 60, 5), z: DRAFT_PREVIEW_Z });
      scene.frame();
      await builder.landAll();
      scene.frame();
      const before = builder.requests.length;
      // The competitor and the pen's next points land in the same frame.
      if (competitor === 'many strokes changed at once') {
        for (const other of others) {
          scene.document.update(other.id, { points: stroke(other.id, 290).points });
        }
      }
      scene.document.update('ink', { points: stroke('ink', 64).points });
      scene.frame(competitor === 'a zoom' ? atZoom(2) : PATH_CAMERA);
      const asked = builder.requests.slice(before).map(({ objectId }) => objectId);
      expect(asked).not.toContain('ink');
      // The competitor spent the shared budget, and the ink still took its slot.
      expect(scene.reports.at(-1)?.segmentsSent).toBeGreaterThan(0);
      expect(scene.reports.at(-1)?.prioritySegments).toBe(64);
    },
  );

  it('meshes both live pieces in the frame a piece fills and the next begins, the budget spent', async () => {
    const builder = new DeferredBuilder();
    const scene = createPathScene({ meshBuilder: builder, maxMeshSegmentsPerFrame: 40 });
    const others = [1, 2].map((index) => stroke(`other-${String(index)}`, 300, index));
    scene.document.create(...others, { ...stroke('piece-1', 1000, 3), z: DRAFT_PREVIEW_Z });
    scene.frame();
    await builder.landAll();
    scene.frame();
    const before = builder.requests.length;
    // The move that fills the first piece starts the second: both previews change in one frame,
    // as a zoom spends the shared budget.
    scene.document.update('piece-1', { points: stroke('piece-1', 1024).points });
    scene.document.create({ ...stroke('piece-2', 3, 4), z: DRAFT_PREVIEW_Z });
    scene.frame(atZoom(2));
    const asked = builder.requests.slice(before).map(({ objectId }) => objectId);
    expect(asked).not.toContain('piece-1');
    expect(asked).not.toContain('piece-2');
    expect(scene.reports.at(-1)?.prioritySegments).toBe(1024 + 3);
  });

  it('meshes a stroke being drawn in the frame its points change, not a stand-in', async () => {
    const builder = new DeferredBuilder();
    const scene = createPathScene({ meshBuilder: builder });
    scene.document.create(stroke('ink', FRESH_STROKE_SEGMENTS + 8));
    scene.frame();
    // A long stroke seen for the first time (a board loading) goes to the builder.
    expect(builder.requests).toHaveLength(1);
    await builder.landAll();
    scene.frame();
    scene.document.update('ink', { points: stroke('ink', FRESH_STROKE_SEGMENTS + 12).points });
    scene.frame();
    expect(builder.requests).toHaveLength(1);
    expect(scene.reports.at(-1)).toMatchObject({ pathsDrawn: 1, meshesBuilt: 1, standIns: 0 });
    expect(scene.renderer.hasPendingWork()).toBe(false);
  });

  it('leaves a changed stroke past the frame’s inline allowance to the builder', async () => {
    const builder = new DeferredBuilder();
    const scene = createPathScene({ meshBuilder: builder, maxMeshSegmentsPerFrame: Infinity });
    const points = 600;
    scene.document.create(stroke('a', points, 0), stroke('b', points, 1));
    scene.frame();
    await builder.landAll();
    scene.frame();
    // Both change in one frame (an undo, two people drawing): one fits the allowance.
    scene.document.update('a', { points: stroke('a', points + 4).points });
    scene.document.update('b', { points: stroke('b', points + 4).points });
    scene.frame();
    expect(2 * points).toBeGreaterThan(INLINE_MESH_SEGMENTS_PER_FRAME);
    expect(builder.requests).toHaveLength(3);
    expect(scene.reports.at(-1)).toMatchObject({ segmentsInline: points + 4, standIns: 1 });
  });

  it('meshes many strokes begun at once only up to the inline allowance a frame', () => {
    const builder = new DeferredBuilder();
    const scene = createPathScene({ meshBuilder: builder, maxMeshSegmentsPerFrame: Infinity });
    const many: FreehandObject[] = [];
    for (let index = 0; index < 40; index += 1) {
      many.push(stroke(`ink-${String(index)}`, FRESH_STROKE_SEGMENTS, index));
    }
    scene.document.create(...many);
    scene.frame();
    const report = scene.reports.at(-1);
    expect(report?.segmentsInline).toBeLessThanOrEqual(INLINE_MESH_SEGMENTS_PER_FRAME);
    expect(report?.segmentsInline).toBeGreaterThan(0);
    // The rest went to the builder, to land on a later frame.
    expect(builder.requests.length).toBe(
      40 - (report?.segmentsInline ?? 0) / FRESH_STROKE_SEGMENTS,
    );
  });

  it('meshes a stroke just begun in its first frame as chords too, zoomed far out', () => {
    const builder = new DeferredBuilder();
    const scene = createPathScene({ meshBuilder: builder });
    scene.document.create(stroke('ink', 3));
    scene.frame(atZoom(0.05));
    expect(builder.requests).toHaveLength(0);
    expect(scene.reports.at(-1)).toMatchObject({ pathsDrawn: 1, standIns: 0 });
    expect(scene.reports.at(-1)?.segmentsInline).toBeGreaterThan(0);
  });

  it('drops a mesh that lands after its path was deleted or the renderer destroyed', async () => {
    const builder = new DeferredBuilder();
    const scene = createPathScene({ meshBuilder: builder });
    scene.document.create(squarePath('p', 0), squarePath('q', 1));
    scene.frame();
    scene.document.delete('p');
    scene.frame();
    scene.renderer.destroy();
    await builder.landAll();
    expect(meshBuffers(scene)).toHaveLength(0);
  });

  it('reports a failed build and draws the path meshed inline instead', async () => {
    const builder = new DeferredBuilder();
    const faults: string[] = [];
    const scene = createPathScene({
      meshBuilder: builder,
      onFault: (error) => faults.push(error.message),
    });
    scene.document.create(squarePath('p', 0));
    scene.frame();
    await builder.failAll();
    // The failure is made inline, and reported, at the next frame's start.
    expect(faults).toHaveLength(0);
    expect(scene.renderer.hasPendingWork()).toBe(true);
    scene.frame();
    expect(faults).toHaveLength(1);
    expect(scene.reports.at(-1)).toMatchObject({ pathsDrawn: 1, meshesBuilt: 0 });
    expect(builder.requests).toHaveLength(1);
    expect(scene.renderer.hasPendingWork()).toBe(false);
    scene.document.update('p', { stroke: { color: [0, 0, 0, 1], width: 3 } });
    scene.frame();
    expect(builder.requests).toHaveLength(2);
  });

  it('stops waiting for a build the pool never answers', () => {
    const builder = new DeferredBuilder();
    const faults: string[] = [];
    const scene = createPathScene({
      meshBuilder: builder,
      buildTimeoutFrames: 2,
      onFault: (error) => faults.push(error.message),
    });
    scene.document.create(squarePath('p', 0));
    scene.frame();
    scene.frame();
    expect(scene.renderer.hasPendingWork()).toBe(true);
    scene.frame();
    expect(faults).toHaveLength(1);
    expect(scene.reports.at(-1)).toMatchObject({ pathsDrawn: 1, pendingMeshes: 0 });
    expect(scene.renderer.hasPendingWork()).toBe(false);
  });
});
