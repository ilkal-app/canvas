import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createPathScene, PATH_CAMERA, squarePath } from './__fixtures__/path-scene.js';
import { PathRegistry } from './path-registry.js';

describe('settled path preparation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps every drawn path but skips repeated slot preparation while all remain enclosed', () => {
    const scene = createPathScene({ meshByteBudget: 1 });
    for (let index = 0; index < 100; index += 1) {
      scene.document.create(squarePath(`p${String(index)}`, index));
    }
    const owner = vi.spyOn(PathRegistry.prototype, 'ownerOf');
    const lookups: number[] = [];
    scene.renderer.frame.wrapStage('preparePathMeshes', (inner) => ({
      name: inner.name,
      run(context) {
        owner.mockClear();
        inner.run(context);
        lookups.push(owner.mock.calls.length);
      },
    }));
    scene.frame();
    const draws = scene.backend.draws().length;
    expect(lookups.at(-1)).toBeGreaterThanOrEqual(100);
    const buffers = scene.backend.buffers.filter(({ label }) => label === 'path mesh');
    scene.backend.resetCalls();
    scene.frame({ ...PATH_CAMERA, x: 1, y: 1, zoom: 1.05 });
    expect(lookups.at(-1)).toBe(0);
    expect(scene.backend.draws()).toHaveLength(draws);
    expect(scene.reports.at(-1)).toMatchObject({ pathsDrawn: 100, meshesBuilt: 0, evictions: 0 });
    expect(buffers.every(({ isDestroyed }) => !isDestroyed)).toBe(true);
    // Outside the prior all-visible region: active pinning must stop for offscreen meshes.
    scene.frame({ ...PATH_CAMERA, x: 1000 });
    expect(scene.reports.at(-1)?.pathsDrawn).toBe(0);
    expect(buffers.every(({ isDestroyed }) => isDestroyed)).toBe(true);
    scene.renderer.destroy();
  });

  it('prepares again after a bucket, LOD, document or instance change', () => {
    const scene = createPathScene();
    scene.document.create(squarePath('p', 0));
    const owner = vi.spyOn(PathRegistry.prototype, 'ownerOf');
    let prepared = 0;
    scene.renderer.frame.wrapStage('preparePathMeshes', (inner) => ({
      name: inner.name,
      run(context) {
        owner.mockClear();
        inner.run(context);
        prepared = owner.mock.calls.length;
      },
    }));
    scene.frame();
    scene.frame();
    expect(prepared).toBe(0);
    scene.frame({ ...PATH_CAMERA, zoom: 2 });
    expect(prepared).toBeGreaterThan(0);
    scene.frame({ ...PATH_CAMERA, zoom: 2 });
    expect(prepared).toBe(0);
    scene.document.update('p', { x: 30 });
    scene.frame({ ...PATH_CAMERA, zoom: 2 });
    expect(prepared).toBeGreaterThan(0);
    scene.frame({ ...PATH_CAMERA, zoom: 2 });
    expect(prepared).toBe(0);
    // An asynchronous instance rewrite is visible before upload clears dirty records.
    const object = scene.document.get('p' as ObjectId);
    if (!object) throw new Error('Missing path.');
    scene.renderer.scene.rewriteRecords('path', [
      { object, transform: { x: 1000, y: 0, cos: 1, sin: 0 } },
    ]);
    scene.frame({ ...PATH_CAMERA, zoom: 2 });
    expect(prepared).toBeGreaterThan(0);
    expect(scene.reports.at(-1)?.pathsDrawn).toBe(0);
    scene.renderer.destroy();
  });

  it('advances a pending job to timeout even at an unchanged camera', () => {
    let abandoned = 0;
    const scene = createPathScene({
      buildTimeoutFrames: 2,
      meshBuilder: {
        build: () => new Promise(() => undefined),
        abandon: () => {
          abandoned += 1;
        },
      },
    });
    scene.document.create(squarePath('p', 0));
    scene.frame();
    expect(scene.renderer.hasPendingWork()).toBe(true);
    scene.frame();
    scene.frame();
    expect(abandoned).toBe(1);
    expect(scene.reports.at(-1)).toMatchObject({ pathsDrawn: 1, pendingMeshes: 0 });
    expect(scene.renderer.hasPendingWork()).toBe(false);
    scene.renderer.destroy();
  });

  it('invalidates a chord change even when the flatten bucket stays the same', () => {
    const scene = createPathScene();
    scene.document.create(squarePath('p', 0));
    scene.frame({ ...PATH_CAMERA, zoom: 0.29 });
    scene.frame({ ...PATH_CAMERA, zoom: 0.29 });
    const bucket = scene.reports.at(-1)?.bucket;
    expect(scene.renderer.scene.levelOfDetail.formOf('path', 'p' as ObjectId)).toBe('full');
    scene.frame({ ...PATH_CAMERA, zoom: 0.21 });
    expect(scene.reports.at(-1)).toMatchObject({ bucket, meshesBuilt: 1 });
    expect(scene.renderer.scene.levelOfDetail.formOf('path', 'p' as ObjectId)).toBe('chord');
    scene.renderer.destroy();
  });

  it('copies mutable range values and falls back after a skipped preparation', () => {
    const scene = createPathScene();
    scene.document.create(squarePath('a', 0), squarePath('b', 1));
    const ranges = [{ start: 0, count: 2 }];
    scene.renderer.frame.insertStage('before', 'preparePathMeshes', {
      name: 'mutablePathRanges',
      run(context) {
        context.drawList.splice(0, context.drawList.length, { passName: 'path', ranges });
      },
    });
    const owner = vi.spyOn(PathRegistry.prototype, 'ownerOf');
    let prepared = 0;
    let shouldSkip = false;
    scene.renderer.frame.wrapStage('preparePathMeshes', (inner) => ({
      name: inner.name,
      run(context) {
        owner.mockClear();
        if (!shouldSkip) inner.run(context);
        prepared = owner.mock.calls.length;
      },
    }));
    scene.frame();
    scene.frame();
    expect(prepared).toBe(0);
    const range = ranges[0];
    if (!range) throw new Error('Missing range.');
    range.start = 2;
    scene.frame();
    expect(prepared).toBe(2);
    expect(scene.reports.at(-1)?.meshesBuilt).toBe(1);
    scene.frame();
    expect(prepared).toBe(0);
    shouldSkip = true;
    scene.frame();
    shouldSkip = false;
    scene.frame();
    expect(prepared).toBe(2);
    scene.renderer.destroy();
  });

  it('evicts an offscreen timeout fallback after its landing frame', () => {
    const scene = createPathScene({
      meshByteBudget: 1,
      buildTimeoutFrames: 2,
      meshBuilder: { build: () => new Promise(() => undefined) },
    });
    scene.document.create(squarePath('p', 0));
    scene.frame();
    const away = { ...PATH_CAMERA, x: 1000 };
    scene.frame(away);
    scene.frame(away);
    expect(scene.reports.at(-1)).toMatchObject({ pathsDrawn: 0, pendingMeshes: 0 });
    const buffers = scene.backend.buffers.filter(({ label }) => label === 'path mesh');
    expect(buffers).toHaveLength(1);
    expect(buffers[0]?.isDestroyed).toBe(false);
    scene.frame(away);
    expect(buffers[0]?.isDestroyed).toBe(true);
    expect(scene.meshBytes()).toBe(0);
    scene.renderer.destroy();
  });
});
