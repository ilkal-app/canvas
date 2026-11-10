import { afterEach, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createPathScene, PATH_CAMERA, squarePath, zigzagPath } from './__fixtures__/path-scene.js';
import { PathDrawCache } from './path-draw-cache.js';
import { PathRegistry } from './path-registry.js';

const commands = (scene: ReturnType<typeof createPathScene>) => {
  const begin = scene.backend.calls.findIndex(({ method }) => method === 'beginRenderPass');
  return scene.backend.calls.slice(begin);
};

afterEach(() => vi.restoreAllMocks());

it('replays settled layers for twenty frames with identical commands and no owner resolution', () => {
  const scene = createPathScene();
  for (let rank = 0; rank < 20; rank += 1)
    scene.document.create(squarePath(`p${String(rank)}`, rank));
  const begin = Reflect.get(PathDrawCache.prototype, 'beginFrame');
  const beginSpy = vi.spyOn(PathDrawCache.prototype, 'beginFrame');
  const caches: PathDrawCache[] = [];
  beginSpy.mockImplementation(function (this: PathDrawCache, ...args) {
    caches.push(this);
    begin.apply(this, args);
  });
  scene.frame();
  scene.backend.resetCalls();
  scene.frame();
  const before = caches.at(-1)?.counts;
  const reference = commands(scene);
  const owner = vi.spyOn(PathRegistry.prototype, 'ownerOf');
  for (let frame = 0; frame < 20; frame += 1) {
    scene.backend.resetCalls();
    scene.frame();
    expect(commands(scene)).toEqual(reference);
  }
  expect(owner.mock.calls.length).toBe(0);
  expect(caches.at(-1)?.counts.resolvedSlots).toBe(before?.resolvedSlots);
  expect(caches.at(-1)?.counts.meshReads).toBe(before?.meshReads);
  expect(caches.at(-1)?.counts.alphaReads).toBe(before?.alphaReads);
  expect(caches.at(-1)?.counts.replayedLayers).toBe((before?.replayedLayers ?? 0) + 800);
  scene.renderer.destroy();
});

it('reads an alpha rewrite after preparation instead of replaying an opaque layer', () => {
  const scene = createPathScene();
  scene.document.create(squarePath('p', 0));
  scene.frame();
  scene.frame();
  let shouldRewrite = true;
  scene.renderer.frame.insertStage('before', 'draw', {
    name: 'lateAlphaWrite',
    run() {
      if (!shouldRewrite) return;
      shouldRewrite = false;
      const object = scene.document.get('p' as ObjectId);
      if (object?.type !== 'path' || !object.stroke) throw new Error('Missing stroked path');
      scene.renderer.scene.rewriteRecords('path', [
        {
          object: { ...object, stroke: { ...object.stroke, color: [0, 0, 0, 0.5] } },
          transform: { x: 10, y: 10, cos: 1, sin: 0 },
        },
      ]);
    },
  });
  scene.backend.resetCalls();
  scene.frame();
  const labels = scene.backend.calls.flatMap((call) =>
    call.method === 'setPipeline' ? [call.label] : [],
  );
  expect(labels.some((label) => label.includes('stroke once'))).toBe(true);
  expect(scene.backend.draws()).toHaveLength(4);
  scene.renderer.destroy();
});

it('re-resolves changed entry boundaries even when flattened ranges stay the same', () => {
  const scene = createPathScene();
  scene.document.create(squarePath('a', 0), squarePath('b', 1));
  let isSplit = false;
  scene.renderer.frame.insertStage('before', 'preparePathMeshes', {
    name: 'splitPathEntries',
    run(context) {
      const entries = isSplit
        ? [
            { passName: 'path', ranges: [{ start: 0, count: 2 }] },
            { passName: 'path', ranges: [{ start: 2, count: 2 }] },
          ]
        : [
            {
              passName: 'path',
              ranges: [
                { start: 0, count: 2 },
                { start: 2, count: 2 },
              ],
            },
          ];
      context.drawList.splice(0, context.drawList.length, ...entries);
    },
  });
  scene.frame();
  scene.frame();
  const owner = vi.spyOn(PathRegistry.prototype, 'ownerOf');
  isSplit = true;
  scene.backend.resetCalls();
  scene.frame();
  expect(owner).toHaveBeenCalledTimes(4);
  expect(scene.backend.count('setBindGroup')).toBe(2);
  const reference = commands(scene);
  owner.mockClear();
  scene.backend.resetCalls();
  scene.frame();
  expect(owner.mock.calls.length).toBe(0);
  expect(commands(scene)).toEqual(reference);
  scene.renderer.destroy();
});

it('rejects a generation invalidated after preparation captured its reuse decision', () => {
  const scene = createPathScene();
  scene.document.create(squarePath('p', 0));
  const begin = Reflect.get(PathDrawCache.prototype, 'beginFrame');
  const beginSpy = vi.spyOn(PathDrawCache.prototype, 'beginFrame');
  let shouldInvalidate = false;
  const caches: PathDrawCache[] = [];
  beginSpy.mockImplementation(function (this: PathDrawCache, ...args) {
    caches.push(this);
    if (shouldInvalidate) this.invalidate();
    begin.apply(this, args);
  });
  scene.frame();
  scene.frame();
  expect(caches.at(-1)?.counts.retainedLayers).toBe(2);
  const before = caches.at(-1)?.counts.resolvedSlots ?? 0;
  shouldInvalidate = true;
  scene.backend.resetCalls();
  scene.frame();
  expect(caches.at(-1)?.counts.retainedLayers).toBe(0);
  expect(caches.at(-1)?.counts.resolvedSlots).toBe(before + 2);
  expect(scene.backend.draws()).toHaveLength(3);
  scene.renderer.destroy();
});

it('bounds retained history to the current entries and drops all buffers on eviction and destroy', () => {
  const scene = createPathScene({ meshByteBudget: 1 });
  scene.document.create(squarePath('a', 0), squarePath('b', 1));
  const begin = Reflect.get(PathDrawCache.prototype, 'beginFrame');
  const beginSpy = vi.spyOn(PathDrawCache.prototype, 'beginFrame');
  const caches: PathDrawCache[] = [];
  beginSpy.mockImplementation(function (this: PathDrawCache, ...args) {
    caches.push(this);
    begin.apply(this, args);
  });
  scene.frame();
  scene.frame();
  expect(caches.at(-1)?.counts.retainedLayers).toBe(4);
  for (let iteration = 0; iteration < 10; iteration += 1) {
    scene.frame({ x: 1000, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 400, viewportHeightPx: 300 });
    expect(caches.at(-1)?.counts.retainedLayers).toBe(0);
    expect(caches.at(-1)?.counts.retainedEntries).toBe(0);
    scene.frame();
    expect(caches.at(-1)?.counts.retainedLayers).toBe(4);
    expect(caches.at(-1)?.counts.retainedEntries).toBeLessThanOrEqual(2);
  }
  scene.renderer.destroy();
  expect(caches.at(-1)?.counts.retainedLayers).toBe(0);
  expect(caches.at(-1)?.counts.retainedEntries).toBe(0);
  expect(
    scene.backend.buffers
      .filter(({ label }) => label === 'path mesh')
      .every(({ isDestroyed }) => isDestroyed),
  ).toBe(true);
});

it('preserves the uncached command stream through edits, LOD changes, deletion and recycled slots', () => {
  const cached = createPathScene();
  const reference = createPathScene();
  let isReference = false;
  const draw = Reflect.get(PathDrawCache.prototype, 'draw');
  const drawSpy = vi.spyOn(PathDrawCache.prototype, 'draw');
  drawSpy.mockImplementation(function (this: PathDrawCache, ...args) {
    if (isReference) this.invalidate();
    draw.apply(this, args);
  });
  const frame = (zoom = 1): void => {
    cached.backend.resetCalls();
    reference.backend.resetCalls();
    isReference = false;
    cached.frame({ ...PATH_CAMERA, zoom });
    isReference = true;
    reference.frame({ ...PATH_CAMERA, zoom });
    isReference = false;
    expect(commands(cached)).toEqual(commands(reference));
  };
  for (const scene of [cached, reference])
    scene.document.create(squarePath('a', 0), squarePath('b', 1));
  frame();
  frame();
  for (const scene of [cached, reference]) scene.document.update('a', { x: 40 });
  frame();
  frame();
  for (const scene of [cached, reference])
    scene.document.update('a', { stroke: { color: [0, 0, 0, 0.5], width: 5 } });
  frame();
  frame();
  frame(0.21);
  frame(0.21);
  frame(0.29);
  frame(2);
  for (const scene of [cached, reference]) scene.document.delete('a');
  frame();
  for (const scene of [cached, reference]) scene.document.create(zigzagPath('c', 2));
  frame();
  frame();
  cached.renderer.destroy();
  reference.renderer.destroy();
});

it('invalidates a replaced GPU instance buffer even with unchanged records and ranges', () => {
  const scene = createPathScene();
  scene.document.create(squarePath('p', 0));
  scene.frame();
  scene.frame();
  const replacement = scene.backend.createBuffer({
    usage: 'vertex',
    byteLength: 4096,
    label: 'replacement instances',
  });
  const draw = Reflect.get(PathDrawCache.prototype, 'draw');
  const drawSpy = vi.spyOn(PathDrawCache.prototype, 'draw');
  drawSpy.mockImplementation(function (this: PathDrawCache, context, entry, pipelines) {
    draw.call(this, { ...context, instanceBuffer: replacement }, entry, pipelines);
  });
  const owner = vi.spyOn(PathRegistry.prototype, 'ownerOf');
  scene.backend.resetCalls();
  scene.frame();
  expect(owner).toHaveBeenCalledTimes(2);
  expect(
    scene.backend.calls.some(
      (call) => call.method === 'setVertexBuffer' && call.label === 'replacement instances',
    ),
  ).toBe(true);
  replacement.destroy();
  scene.renderer.destroy();
});
