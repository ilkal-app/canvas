import { describe, expect, it } from 'vitest';

import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import { shapeObject, zKeyAt } from '../scene/__fixtures__/scene-objects.js';
import { AllVisibleCuller } from '../scene/scene-culler.js';
import { lineObject, pathObject } from '../spatial/__fixtures__/spatial-objects.js';

import { buildNetwork, ringPairs } from './__fixtures__/networks.js';
import { createPathScene, squarePath, zigzagPath } from './__fixtures__/path-scene.js';
import { INLINE_MESH_BUILDER } from './path-mesh-builder.js';
import { COVER_VERTEX_COUNT } from './path-mesh.js';
import { createPathPass } from './path-pass.js';

const PATH_PASS = createPathPass({ meshBuilder: INLINE_MESH_BUILDER });

const drawnPipelines = (scene: ReturnType<typeof createPathScene>): string[] =>
  scene.backend.calls.flatMap((call) => (call.method === 'setPipeline' ? [call.label] : []));

describe('path pass records', () => {
  const transform = { cos: 0.6, sin: 0.8, x: 5, y: 7 };

  it('gives a filled, stroked closed path a fill record then a stroke record', () => {
    const square = squarePath('p', 0, { fill: [0.1, 0.2, 0.3, 0.4] });
    expect(PATH_PASS.recordCount(square)).toBe(2);
    const record = new Float32Array(8);
    PATH_PASS.prepare(record, { object: square, transform }, 0);
    expect([...record]).toEqual([0.6, 0.8, 5, 7, 0.1, 0.2, 0.3, 0.4].map(Math.fround));
    PATH_PASS.prepare(record, { object: square, transform }, 1);
    expect([...record.subarray(4)]).toEqual([0, 0, 0, 1]);
  });

  it('draws a stroke only for an open path, a branching network or no fill colour', () => {
    const theta = pathObject(
      'theta',
      [],
      {},
      {
        ...buildNetwork(
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
          [...ringPairs([0, 1, 2, 3]), [0, 2]],
        ),
        fill: [1, 0, 0, 1],
      },
    );
    for (const object of [zigzagPath('z', 0), theta, squarePath('bare', 0, { fill: null })]) {
      expect(PATH_PASS.recordCount(object)).toBe(1);
      expect(PATH_PASS.isOccluder?.(object)).toBe(true);
    }
  });

  it('makes a filled closed path an occluder, and draws nothing for other objects', () => {
    expect(PATH_PASS.isOccluder?.(squarePath('p', 0))).toBe(true);
    expect(PATH_PASS.recordCount(shapeObject('s'))).toBe(0);
    expect(PATH_PASS.isOccluder?.(shapeObject('s'))).toBe(false);
    const nothing = squarePath('none', 0, { fill: null, stroke: null });
    expect(PATH_PASS.recordCount(nothing)).toBe(0);
    expect(PATH_PASS.isOccluder?.(nothing)).toBe(false);
    const record = new Float32Array(8);
    PATH_PASS.prepare(record, { object: shapeObject('s'), transform }, 0);
    PATH_PASS.prepare(record, { object: nothing, transform }, 0);
    expect([...record]).toEqual(new Array(8).fill(0));
  });

  it('gives a line one stroke record and flags it for paint ordering', () => {
    const line = lineObject('l', {
      stroke: { color: [0.5, 0.25, 0, 1], width: 3 },
      endCap: 'arrow',
    });
    expect(PATH_PASS.recordCount(line)).toBe(1);
    expect(PATH_PASS.isOccluder?.(line)).toBe(true);
    const record = new Float32Array(8);
    PATH_PASS.prepare(record, { object: line, transform }, 0);
    expect([...record]).toEqual([0.6, 0.8, 5, 7, 0.5, 0.25, 0, 1].map(Math.fround));
  });

  it('can be created under another name', () => {
    expect(createPathPass({ name: 'lines', meshBuilder: INLINE_MESH_BUILDER }).name).toBe('lines');
    expect(PATH_PASS.name).toBe('path');
  });
});

describe('path pass drawing', () => {
  it('fills through the stencil, then strokes, each record placing the shared mesh', () => {
    const scene = createPathScene();
    scene.document.create(squarePath('p', 0));
    scene.frame();
    const [report] = scene.reports;
    expect(report).toMatchObject({ bucket: 0, pathsDrawn: 1, meshesBuilt: 1, standIns: 0 });
    expect(scene.backend.buffers.filter(({ label }) => label === 'path mesh')).toHaveLength(1);
    expect(drawnPipelines(scene)).toEqual(['path fill stencil', 'path fill cover', 'path stroke']);
    const draws = scene.backend.draws();
    expect(draws).toHaveLength(3);
    const [fans, cover, stroke] = draws;
    const fillVertices = fans?.vertexCount ?? 0;
    expect(fans).toMatchObject({ firstVertex: 0, instanceCount: 1, firstInstance: 0 });
    expect(cover).toEqual({
      method: 'draw',
      vertexCount: COVER_VERTEX_COUNT,
      instanceCount: 1,
      firstVertex: fillVertices,
      firstInstance: 0,
    });
    expect(stroke).toMatchObject({
      firstVertex: fillVertices + COVER_VERTEX_COUNT,
      firstInstance: 1,
    });
  });

  it('draws a line as one stroke from its own mesh, and remeshes it only when its shape changes', () => {
    const scene = createPathScene();
    scene.document.create(lineObject('l', { x: 20, y: 20, endCap: 'triangle' }));
    scene.frame();
    expect(scene.reports.at(-1)).toMatchObject({ pathsDrawn: 1, meshesBuilt: 1 });
    expect(drawnPipelines(scene)).toEqual(['path stroke']);
    expect(scene.backend.draws()[0]).toMatchObject({ firstVertex: COVER_VERTEX_COUNT });
    scene.document.update('l', { x: 60, stroke: { color: [1, 0, 0, 1], width: 2 } });
    scene.frame();
    expect(scene.reports.at(-1)).toMatchObject({ pathsDrawn: 1, meshesBuilt: 0 });
    scene.document.update('l', { route: 'elbow' });
    scene.frame();
    expect(scene.reports.at(-1)).toMatchObject({ meshesBuilt: 1 });
  });

  it('creates its five pipelines with the even-odd stencil states', () => {
    const scene = createPathScene();
    expect(scene.backend.count('createRenderPipeline')).toBe(5);
    // Their one bind group is built on first draw (it follows the clip table's texture).
    expect(scene.backend.count('createBindGroup')).toBe(0);
  });

  it('draws a translucent stroke once per pixel and clears the stencil after it', () => {
    const scene = createPathScene();
    scene.document.create(zigzagPath('z', 0, { stroke: { color: [0, 0, 0, 0.5], width: 4 } }));
    scene.frame();
    expect(drawnPipelines(scene)).toEqual(['path stroke once', 'path stencil clear']);
    const [strokeDraw, clear] = scene.backend.draws();
    expect(strokeDraw?.firstVertex).toBe(COVER_VERTEX_COUNT);
    expect(clear).toMatchObject({ vertexCount: COVER_VERTEX_COUNT, firstVertex: 0 });
  });

  it('keeps z order with other passes: a filled path covers a rectangle below it', () => {
    const scene = createPathScene({ passesBefore: [FILLED_RECT_PASS] });
    scene.document.create(
      shapeObject('under', { x: 0, y: 0, z: zKeyAt(0) }),
      squarePath('path', 1),
      shapeObject('over', { x: 15, y: 15, z: zKeyAt(2) }),
    );
    scene.frame();
    const order = scene.backend.calls.flatMap((call) =>
      call.method === 'setVertexBuffer' && call.slot === 0 ? [call.label] : [],
    );
    expect(order).toEqual(['solid-rect vertices', 'path mesh', 'solid-rect vertices']);
  });

  it('binds one shared mesh buffer for many paths, each drawn from its first vertex', () => {
    const scene = createPathScene();
    scene.document.create(squarePath('a', 0), zigzagPath('b', 1), squarePath('c', 2, { x: 40 }));
    scene.frame();
    const meshBinds = scene.backend.calls.filter(
      (call) => call.method === 'setVertexBuffer' && call.slot === 0 && call.label === 'path mesh',
    );
    expect(meshBinds).toHaveLength(1);
    expect(scene.backend.buffers.filter(({ label }) => label === 'path mesh')).toHaveLength(1);
    // Each path draws from its own first vertex in the shared buffer: one mesh after another.
    const startOf = new Map<number, number>();
    for (const { firstInstance, firstVertex } of scene.backend.draws()) {
      startOf.set(firstInstance, Math.min(startOf.get(firstInstance) ?? Infinity, firstVertex));
    }
    expect([...startOf.values()].sort((first, second) => first - second)[0]).toBe(0);
    expect(new Set(startOf.values()).size).toBe(startOf.size);
  });

  it('binds a mesh’s page again when the next mesh is in another one', () => {
    // Pages of 256 bytes: each square's mesh fills most of a page, so each has its own page.
    const scene = createPathScene({ meshPageBytes: 256 });
    scene.document.create(
      squarePath('a', 0),
      squarePath('b', 1, { x: 40 }),
      squarePath('c', 2, { x: 80 }),
    );
    scene.frame();
    const pages = scene.backend.buffers.filter(({ label }) => label === 'path mesh');
    expect(pages.length).toBeGreaterThan(1);
    const binds = scene.backend.calls.flatMap((call) =>
      call.method === 'setVertexBuffer' && call.slot === 0 ? [call] : [],
    );
    // One bind per change of page, in draw order.
    expect(binds.length).toBeGreaterThanOrEqual(pages.length);
    expect(binds.length).toBeLessThanOrEqual(3);
  });

  it('counts its draws in the frame stats', () => {
    const scene = createPathScene();
    scene.document.create(squarePath('p', 0), zigzagPath('z', 1));
    scene.renderer.enqueue(scene.document.takeChanges());
    const stats = scene.renderer.renderFrame({
      timeMs: 0,
      camera: { x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 },
    });
    expect(stats.drawCalls).toBe(4);
  });

  it('does not mesh or draw a path whose records the culler reports but which is off screen', () => {
    const scene = createPathScene({ culler: new AllVisibleCuller() });
    scene.document.create(squarePath('near', 0), squarePath('far', 1, { x: 5000 }));
    scene.frame();
    expect(scene.reports.at(-1)?.pathsDrawn).toBe(1);
    expect(scene.reports.at(-1)?.meshesBuilt).toBe(1);
    expect(scene.backend.draws()).toHaveLength(3);
  });
});
