import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { TransformTable } from '../../gpu/transform-table.js';
import type { FakeGpuCall } from '../../scene/__fixtures__/fake-gpu-backend.js';
import type { ScenePassFactory } from '../../scene/scene-pass.js';
import { loadBundledFaces } from '../__fixtures__/bundled-fonts.js';
import { preloadLayoutShaper } from '../layout/layout-job.js';

import { CAMERA, createTextSetUp, STYLE, textObject } from './__fixtures__/text-objects.js';
import { TEXT_PASS } from './text-pass.js';
import { TextVectorDrawer } from './text-vector-drawer.js';
import { TEXT_VECTOR_PASS, TEXT_VECTOR_PASS_NAME } from './text-vector-pass.js';
import { textVectorOf } from './text-vector-state.js';

/** 20 px text at 32×: 640 device px per em, the vector tier. */
const HIGH = { ...CAMERA, zoom: 32 };
const live: ReturnType<typeof createTextSetUp>[] = [];

beforeAll(async () => {
  await preloadLayoutShaper();
});

afterEach(() => {
  for (const setup of live.splice(0)) {
    setup.renderer.destroy();
    setup.pool.terminate();
  }
});

/**
 * A renderer with the vector companion, whose drawer keeps `budget` bytes of off-screen meshes.
 *
 * @param budget - The drawer's mesh budget.
 * @returns The set-up and a reader of its drawer.
 */
function setUp(budget?: number) {
  const drawers: TextVectorDrawer[] = [];
  const pass: ScenePassFactory = {
    name: TEXT_VECTOR_PASS_NAME,
    create(environment) {
      const created = TEXT_VECTOR_PASS.create(environment);
      const state = textVectorOf(environment);
      if (state === undefined) throw new Error('no vector state');
      return {
        ...created,
        createDrawer(setup) {
          const drawer = new TextVectorDrawer(setup, created, state, budget);
          drawers.push(drawer);
          return drawer;
        },
      };
    },
  };
  const setup = createTextSetUp(
    HIGH,
    true,
    false,
    { passes: [TEXT_PASS, pass] },
    { hasVectorGlyphs: true },
  );
  live.push(setup);
  const drawer = (): TextVectorDrawer => {
    const [first] = drawers;
    if (first === undefined) throw new Error('no drawer');
    return first;
  };
  return { ...setup, drawer };
}

function stencilDraws(
  calls: readonly FakeGpuCall[],
): { firstInstance: number; vertexCount: number }[] {
  let pipeline = '';
  const draws: { firstInstance: number; vertexCount: number }[] = [];
  for (const call of calls) {
    if (call.method === 'setPipeline') pipeline = call.label;
    if (call.method === 'draw' && pipeline === 'textVector count') {
      draws.push({ firstInstance: call.firstInstance, vertexCount: call.vertexCount });
    }
  }
  return draws;
}

function vectorDraws(calls: readonly FakeGpuCall[]): string[] {
  let pipeline = '';
  const draws: string[] = [];
  for (const call of calls) {
    if (call.method === 'setPipeline') pipeline = call.label;
    if (call.method === 'draw' && pipeline.startsWith(TEXT_VECTOR_PASS_NAME)) draws.push(pipeline);
  }
  return draws;
}

async function show(setup: ReturnType<typeof setUp>, ...texts: [string, string, number?][]) {
  setup.document.create(...texts.map(([id, text, x = 0]) => textObject(id, text, { x })));
  setup.renderer.enqueue(setup.document.takeChanges());
  await setup.settle(24, CAMERA);
  await setup.settle(24, HIGH);
}

describe('TextVectorDrawer', () => {
  it('holds its meshes as memory, has no work of its own, and frees all on destroy', async () => {
    const setup = setUp();
    await show(setup, ['a', 'Ag']);
    const drawer = setup.drawer();
    expect(drawer.hasPendingWork()).toBe(false);
    expect(drawer.memory().category).toBe('meshes');
    expect(drawer.memory().bytes).toBeGreaterThan(0);
    drawer.destroy();
    expect(drawer.memory().bytes).toBe(0);
  });

  it('draws with its move pipelines and the move indices while a placement is set', async () => {
    const setup = setUp();
    await show(setup, ['a', 'A']);
    const drawer = setup.drawer();
    const table = new TransformTable(setup.backend, 1);
    const indexData = new Float32Array(16);
    const indices = setup.backend.createBuffer({ usage: 'vertex', byteLength: 64, label: 'idx' });
    drawer.setMovePlacement({ table, indices, indexData });
    const pipelines = setup.backend.pipelines.length;
    // The same table with other indices keeps the move pipelines.
    const other = setup.backend.createBuffer({ usage: 'vertex', byteLength: 64, label: 'idx2' });
    drawer.setMovePlacement({ table, indices: other, indexData });
    expect(setup.backend.pipelines).toHaveLength(pipelines);
    setup.backend.resetCalls();
    setup.renderer.renderFrame({ timeMs: 5000, camera: HIGH });
    expect(vectorDraws(setup.backend.calls)).toEqual([
      'textVector move count',
      'textVector move edges',
      'textVector move cover',
      'textVector move cleanup',
    ]);
    expect(setup.backend.calls).toContainEqual({
      method: 'setVertexBuffer',
      slot: 2,
      label: 'idx2',
    });
    drawer.setMovePlacement(undefined);
    drawer.setMovePlacement({ table, indices, indexData });
    drawer.destroy();
    table.destroy();
  });

  it('keeps on-screen meshes over its budget and frees those off screen', async () => {
    const setup = setUp(0);
    await show(setup, ['near', 'A'], ['far', 'B', 1000]);
    const near = setup.drawer().memory().bytes;
    expect(near).toBeGreaterThan(0);
    // Panned to the far text: the near one's mesh, off screen, goes; the far one's is built.
    await setup.settle(24, { ...HIGH, x: 1000 });
    const far = setup.drawer().memory().bytes;
    expect(far).toBeGreaterThan(0);
    expect(far).not.toBe(near);
    setup.renderer.renderFrame({ timeMs: 6016, camera: CAMERA });
    await setup.settle(24, CAMERA);
    expect(setup.drawer().memory().bytes).toBe(0);
  });

  it('builds a run again when its text is laid out again', async () => {
    const setup = setUp();
    await show(setup, ['a', 'A']);
    const before = setup.drawer().memory().bytes;
    setup.document.update('a', { text: 'AAAA', runs: [{ length: 4, style: STYLE }] });
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle(24, HIGH);
    expect(setup.drawer().memory().bytes).toBeGreaterThan(before);
  });

  it('draws nothing for a run of spaces at the vector tier', async () => {
    const setup = setUp();
    await show(setup, ['blank', '   ']);
    setup.backend.resetCalls();
    setup.renderer.renderFrame({ timeMs: 7000, camera: HIGH });
    expect(vectorDraws(setup.backend.calls)).toEqual([]);
    expect(setup.drawer().memory().bytes).toBe(0);
  });

  it('follows a drawn run to its new slot when the scene moves its record', async () => {
    const setup = setUp();
    await show(setup, ['a', 'A']);
    const { scene } = setup.renderer;
    const [before] = scene.slotsOf('a' as never, TEXT_VECTOR_PASS_NAME);
    // Compaction re-slots the record without the text changing.
    expect(scene.compactSlots(TEXT_VECTOR_PASS_NAME, ['a' as never], true)).toBe(1);
    const [after] = scene.slotsOf('a' as never, TEXT_VECTOR_PASS_NAME);
    expect(after).not.toBe(before);
    setup.backend.resetCalls();
    setup.renderer.renderFrame({ timeMs: 8000, camera: HIGH });
    expect(stencilDraws(setup.backend.calls).map(({ firstInstance }) => firstInstance)).toEqual([
      after,
    ]);
  });

  it('builds its meshes again from the new outlines when a face is replaced under its id', async () => {
    const setup = setUp();
    await show(setup, ['a', 'A']);
    const [regular, bold] = loadBundledFaces();
    if (!regular || !bold) throw new Error('Missing bundled faces');
    setup.backend.resetCalls();
    setup.fonts.addFace(regular.face, bold.bytes);
    await setup.settle(24, HIGH);
    // The layout stays (the same face ids), but the run's mesh is uploaded again, from new outlines.
    const uploads = setup.backend.calls.filter(
      (call) => call.method === 'createBuffer' && call.label === 'textVector run',
    );
    expect(uploads).toHaveLength(1);
    setup.backend.resetCalls();
    setup.renderer.renderFrame({ timeMs: 9000, camera: HIGH });
    expect(stencilDraws(setup.backend.calls)).toHaveLength(1);
  });
});
