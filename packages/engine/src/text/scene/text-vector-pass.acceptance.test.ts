// Acceptance: off switch; pending atlas fallback and atomic per-run replacement;
// path-layout placement and palette colour; zoom-out and hysteresis; font invalidation; retained
// move pipeline creation. The colour-bitmap case is a TODO because this fixture has no such font.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { INK_COLORS, type ObjectId } from '@canvas/schema';

import { TransformTable } from '../../gpu/transform-table.js';
import type { FakeGpuCall } from '../../scene/__fixtures__/fake-gpu-backend.js';
import { shapeObject } from '../../scene/__fixtures__/scene-objects.js';
import type { ScenePassDrawer } from '../../scene/scene-pass-drawer.js';
import type { ScenePassFactory } from '../../scene/scene-pass.js';
import { worldTransformOf } from '../../scene/world-transform.js';
import { loadBundledFaces, loadRegularFontBytes } from '../__fixtures__/bundled-fonts.js';
import { preloadLayoutShaper } from '../layout/layout-job.js';

import { CAMERA, createTextSetUp, STYLE, textObject } from './__fixtures__/text-objects.js';
import { TEXT_PASS } from './text-pass.js';
import { TEXT_VECTOR_PASS, TEXT_VECTOR_PASS_NAME } from './text-vector-pass.js';

const HIGH_CAMERA = { ...CAMERA, zoom: 32 };
const ID = 'vector-text' as ObjectId;
const live: ReturnType<typeof createTextSetUp>[] = [];

beforeAll(async () => {
  await preloadLayoutShaper();
});

afterEach(() => {
  for (const setup of live.splice(0)) {
    setup.renderer.destroy();
    setup.pool.terminate();
  }
  vi.restoreAllMocks();
});

function setUp(isVectorEnabled = true, pass: ScenePassFactory = TEXT_VECTOR_PASS) {
  const setup = createTextSetUp(
    HIGH_CAMERA,
    true,
    false,
    { passes: [TEXT_PASS, pass] },
    isVectorEnabled ? { hasVectorGlyphs: true } : {},
  );
  live.push(setup);
  return setup;
}

function vectorRecords(setup: ReturnType<typeof createTextSetUp>): Float32Array[] {
  const buffer = setup.renderer.scene.instanceBufferOf(TEXT_VECTOR_PASS_NAME);
  const stride = buffer.layout.floatsPerRecord;
  return Array.from({ length: buffer.recordCount }, (ignored, slot) =>
    buffer.data.slice(slot * stride, (slot + 1) * stride),
  );
}

function isDrawn(record: Float32Array): boolean {
  return (record[6] ?? 0) > 0 && (record[7] ?? 0) > 0;
}

function vectorDraws(calls: readonly FakeGpuCall[]) {
  let pipeline = '';
  const draws: {
    pipeline: string;
    vertexCount: number;
    instanceCount: number;
    firstInstance: number;
  }[] = [];
  for (const call of calls) {
    if (call.method === 'setPipeline') pipeline = call.label;
    if (call.method === 'draw' && pipeline.startsWith(TEXT_VECTOR_PASS_NAME)) {
      draws.push({
        pipeline,
        vertexCount: call.vertexCount,
        instanceCount: call.instanceCount,
        firstInstance: call.firstInstance,
      });
    }
  }
  return draws;
}

async function drawAtHighZoom(setup: ReturnType<typeof createTextSetUp>): Promise<void> {
  // Let the atlas glyphs land at 1× before requesting their vector replacements.
  await setup.settle(12, CAMERA);
  setup.renderer.renderFrame({ timeMs: 1000, camera: HIGH_CAMERA });
  await Promise.resolve(); // VectorGlyphSource batches requests in a microtask.
}

describe('text vector companion pass', () => {
  it('counts style runs of text-kind objects from the object alone', () => {
    const setup = setUp();
    const pass = setup.renderer.scene.passes.find(({ name }) => name === TEXT_VECTOR_PASS_NAME);
    expect(pass).toBeDefined();
    const object = textObject(ID, 'AB', {
      runs: [
        { length: 1, style: STYLE },
        { length: 1, style: { ...STYLE, fontSize: 10 } },
      ],
    });
    expect(pass?.recordCount(object)).toBe(2);
    expect(pass?.recordCount(object)).toBe(2);
    expect(pass?.recordCount(shapeObject('not-text'))).toBe(0);
  });

  it('keeps the switch off by default: no geometry jobs or vector draws at 640 px/em', async () => {
    const setup = setUp(false);
    const submit = vi.spyOn(setup.pool, 'submit');
    setup.document.create(textObject(ID, 'AB'));
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle();
    expect(submit.mock.calls.some(([kind]) => kind === 'glyphGeometry')).toBe(false);
    expect(setup.records().every(isDrawn)).toBe(true);
    expect(vectorDraws(setup.backend.calls)).toEqual([]);
  });

  it('keeps atlas records while geometry is pending, then switches only the ready run as a unit', async () => {
    const setup = setUp();
    const submit = vi.spyOn(setup.pool, 'submit');
    const object = textObject(ID, 'ABC', {
      runs: [
        { length: 2, style: { ...STYLE, color: [1, 0, 0, 1] } },
        { length: 1, style: { ...STYLE, fontSize: 10, color: [0, 0, 1, 1] } },
      ],
    });
    setup.document.create(object);
    setup.renderer.enqueue(setup.document.takeChanges());
    await drawAtHighZoom(setup);
    expect(submit.mock.calls.some(([kind]) => kind === 'glyphGeometry')).toBe(true);
    expect(setup.records().map(isDrawn)).toEqual([true, true, true]);
    expect(vectorDraws(setup.backend.calls)).toEqual([]);

    await setup.settle();
    expect(setup.records().map(isDrawn)).toEqual([false, false, true]);
    const [slot] = setup.renderer.scene.slotsOf(ID, TEXT_VECTOR_PASS_NAME);
    expect(slot).toBeDefined();
    setup.backend.resetCalls();
    setup.renderer.renderFrame({ timeMs: 2000, camera: HIGH_CAMERA });
    const draws = vectorDraws(setup.backend.calls);
    // Count, edge hulls, cover, cleanup.
    expect(draws).toHaveLength(4);
    expect(draws[0]).toMatchObject({
      pipeline: 'textVector count',
      instanceCount: 1,
      firstInstance: slot,
    });
    expect(draws[0]?.vertexCount).toBeGreaterThan(0);
    expect(draws[1]).toMatchObject({
      pipeline: 'textVector edges',
      instanceCount: 1,
      firstInstance: slot,
    });
    expect(draws[1]?.vertexCount).toBeGreaterThan(0);
    for (const [index, pipeline] of [
      [2, 'textVector cover'],
      [3, 'textVector cleanup'],
    ] as const)
      expect(draws[index]).toEqual({
        pipeline,
        vertexCount: 6,
        instanceCount: 1,
        firstInstance: slot,
      });
  });

  it('stores one stable path-layout record per style run with world placement and resolved colour', async () => {
    const setup = setUp();
    setup.renderer.setTheme('dark');
    const object = textObject(ID, 'AB', {
      x: 30,
      y: 40,
      rotation: Math.PI / 2,
      runs: [
        { length: 1, style: { ...STYLE, color: 'ink' } },
        { length: 1, style: { ...STYLE, fontSize: 10, color: [0, 0.5, 1, 0.75] } },
      ],
    });
    setup.document.create(object);
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle();
    const before = vectorRecords(setup);
    expect(before).toHaveLength(2);
    const { cos, sin, x, y } = worldTransformOf(object, setup.document);
    for (const record of before) {
      expect([...record.subarray(0, 4)]).toEqual([cos, sin, x, y].map(Math.fround));
    }
    expect([...(before[0]?.subarray(4, 8) ?? [])]).toEqual(INK_COLORS.dark.map(Math.fround));
    expect([...(before[1]?.subarray(4, 8) ?? [])]).toEqual([0, 0.5, 1, 0.75]);
    await drawAtHighZoom(setup);
    await setup.settle();
    expect(vectorRecords(setup)).toEqual(before);
  });

  it('returns to atlas drawing after zooming out and honors vector hysteresis at 480 and 400 px/em', async () => {
    const setup = setUp();
    setup.document.create(textObject(ID, 'A'));
    setup.renderer.enqueue(setup.document.takeChanges());
    await drawAtHighZoom(setup);
    await setup.settle();
    expect(setup.records().map(isDrawn)).toEqual([false]);

    setup.backend.resetCalls();
    setup.renderer.renderFrame({ timeMs: 2000, camera: { ...CAMERA, zoom: 24 } });
    expect(setup.records().map(isDrawn)).toEqual([false]);
    expect(vectorDraws(setup.backend.calls)).toHaveLength(4);

    setup.backend.resetCalls();
    setup.renderer.renderFrame({ timeMs: 2016, camera: { ...CAMERA, zoom: 20 } });
    await setup.settle(12, { ...CAMERA, zoom: 20 });
    expect(setup.records().map(isDrawn)).toEqual([true]);
    expect(vectorDraws(setup.backend.calls)).toEqual([]);

    setup.backend.resetCalls();
    setup.renderer.renderFrame({ timeMs: 3000, camera: CAMERA });
    await setup.settle(12, CAMERA);
    expect(setup.records().map(isDrawn)).toEqual([true]);
    expect(vectorDraws(setup.backend.calls)).toEqual([]);
  });

  it('drops and requests geometry again when the font set changes', async () => {
    const setup = setUp();
    const submit = vi.spyOn(setup.pool, 'submit');
    setup.document.create(textObject(ID, 'A'));
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle();
    expect(setup.records().map(isDrawn)).toEqual([false]);
    const firstJobs = submit.mock.calls.filter(([kind]) => kind === 'glyphGeometry').length;
    expect(firstJobs).toBeGreaterThan(0);
    setup.fonts.addFace(
      { family: 'New bundled face', weight: 400, isItalic: false },
      loadRegularFontBytes(),
    );
    setup.renderer.renderFrame({ timeMs: 2000, camera: HIGH_CAMERA });
    await setup.settle();
    expect(submit.mock.calls.filter(([kind]) => kind === 'glyphGeometry').length).toBeGreaterThan(
      firstJobs,
    );
    expect(setup.records().map(isDrawn)).toEqual([false]);
  });

  it('does not reuse outlines when a face is replaced under the same id', async () => {
    const setup = setUp();
    const submit = vi.spyOn(setup.pool, 'submit');
    setup.document.create(textObject(ID, 'A'));
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle();
    const before = submit.mock.calls.filter(([kind]) => kind === 'glyphGeometry').length;
    const regular = loadBundledFaces()[0];
    const bold = loadBundledFaces()[1];
    if (!regular || !bold) throw new Error('Missing bundled faces');
    setup.fonts.addFace(regular.face, bold.bytes);
    setup.renderer.renderFrame({ timeMs: 2000, camera: HIGH_CAMERA });
    expect(setup.records().map(isDrawn)).toEqual([true]);
    await setup.settle();
    expect(submit.mock.calls.filter(([kind]) => kind === 'glyphGeometry').length).toBeGreaterThan(
      before,
    );
    expect(setup.records().map(isDrawn)).toEqual([false]);
  });

  it('builds retained-move count, edge, cover and cleanup pipelines when given a placement', () => {
    let drawer: ScenePassDrawer | undefined;
    const wrapped: ScenePassFactory = {
      name: TEXT_VECTOR_PASS.name,
      create(environment) {
        const pass = TEXT_VECTOR_PASS.create(environment);
        return {
          ...pass,
          createDrawer(setup) {
            drawer = pass.createDrawer?.(setup);
            if (!drawer) throw new Error('Missing text vector drawer');
            return drawer;
          },
        };
      },
    };
    const setup = setUp(true, wrapped);
    expect(typeof drawer?.setMovePlacement).toBe('function');
    const table = new TransformTable(setup.backend, 1);
    const indexData = new Float32Array(1);
    const indices = setup.backend.createBuffer({
      usage: 'vertex',
      byteLength: indexData.byteLength,
    });
    try {
      drawer?.setMovePlacement?.({ table, indices, indexData });
      const labels = setup.backend.pipelines.map(({ label }) => label);
      for (const stage of ['count', 'edges', 'cover', 'cleanup'])
        expect(labels).toContain(`textVector move ${stage}`);
      drawer?.setMovePlacement?.(undefined);
    } finally {
      table.destroy();
      indices.destroy();
    }
  });

  // The bundled Liberation Sans faces contain no colour bitmap glyph. The colour-raster tests
  // inject a canvas into the msdf job, while this fixture uses the production fallback handlers.
  it.todo('keeps a colour-bitmap glyph on the 512 atlas tier at vector zoom');
});
