import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { TransformTable } from '../../gpu/transform-table.js';
import type { FakeGpuCall, FakeGpuPipeline } from '../../scene/__fixtures__/fake-gpu-backend.js';
import type { ScenePassFactory } from '../../scene/scene-pass.js';
import { preloadLayoutShaper } from '../layout/layout-job.js';

import { CAMERA, createTextSetUp, textObject } from './__fixtures__/text-objects.js';
import { TEXT_PASS } from './text-pass.js';
import { TextVectorDrawer } from './text-vector-drawer.js';
import { TEXT_VECTOR_PASS, TEXT_VECTOR_PASS_NAME } from './text-vector-pass.js';
import { textVectorOf } from './text-vector-state.js';

const HIGH = { ...CAMERA, zoom: 32 };
const live: ReturnType<typeof createTextSetUp>[] = [];

beforeAll(async () => preloadLayoutShaper());
afterEach(() => {
  for (const setup of live.splice(0)) {
    setup.renderer.destroy();
    setup.pool.terminate();
  }
});

function setup() {
  let drawer: TextVectorDrawer | undefined;
  const pass: ScenePassFactory = {
    name: TEXT_VECTOR_PASS_NAME,
    create(environment) {
      const created = TEXT_VECTOR_PASS.create(environment);
      const state = textVectorOf(environment);
      if (state === undefined) throw new Error('missing vector state');
      return {
        ...created,
        createDrawer(input) {
          drawer = new TextVectorDrawer(input, created, state);
          return drawer;
        },
      };
    },
  };
  const result = createTextSetUp(
    HIGH,
    true,
    false,
    { passes: [TEXT_PASS, pass] },
    { hasVectorGlyphs: true },
  );
  live.push(result);
  return {
    ...result,
    drawer: () => {
      if (!drawer) throw new Error('missing drawer');
      return drawer;
    },
  };
}

async function show(result: ReturnType<typeof setup>) {
  result.document.create(textObject('aa', 'A'));
  result.renderer.enqueue(result.document.takeChanges());
  await result.settle(24, CAMERA);
  await result.settle(24, HIGH);
}

function vectorDraws(calls: readonly FakeGpuCall[]): { label: string; vertexCount: number }[] {
  const draws: { label: string; vertexCount: number }[] = [];
  let label = '';
  for (const call of calls) {
    if (call.method === 'setPipeline') label = call.label;
    if (call.method === 'draw' && label.startsWith(TEXT_VECTOR_PASS_NAME))
      draws.push({ label, vertexCount: call.vertexCount });
  }
  return draws;
}

function expectPipeline(
  pipeline: FakeGpuPipeline | undefined,
  colorWrite: string,
  stencil: Record<string, unknown>,
) {
  expect(pipeline?.colorWrite).toBe(colorWrite);
  expect(pipeline?.stencil).toMatchObject(stencil);
}

function verifyFour(result: ReturnType<typeof setup>, isMoving: boolean) {
  result.backend.resetCalls();
  const stats = result.renderer.renderFrame({ timeMs: 5000, camera: HIGH });
  const draws = vectorDraws(result.backend.calls);
  const prefix = isMoving ? 'textVector move ' : 'textVector ';
  expect(draws.map(({ label }) => label)).toEqual(
    ['count', 'edges', 'cover', 'cleanup'].map((name) => `${prefix}${name}`),
  );
  expect(draws[0]?.vertexCount).toBeGreaterThan(6);
  expect(draws[1]?.vertexCount).toBeGreaterThan(0);
  expect(draws[2]?.vertexCount).toBe(6);
  expect(draws[3]?.vertexCount).toBe(6);
  const pipeline = (name: string) =>
    result.backend.pipelines.find((item) => item.label === `${prefix}${name}`);
  expectPipeline(pipeline('count'), 'none', {
    compare: 'always',
    passOperation: 'increment-wrap',
    backPassOperation: 'decrement-wrap',
    writeMask: 0x7f,
  });
  expectPipeline(pipeline('edges'), 'all', {
    compare: 'not-equal',
    reference: 0x80,
    readMask: 0x80,
    passOperation: 'replace',
    writeMask: 0xff,
  });
  expectPipeline(pipeline('cover'), 'all', {
    compare: 'not-equal',
    reference: 0,
    readMask: 0x7f,
    passOperation: 'zero',
  });
  expectPipeline(pipeline('cleanup'), 'none', {
    compare: 'not-equal',
    reference: 0,
    readMask: 0xff,
    passOperation: 'zero',
  });
  // Adapted by Claude: the frame also counts the text pass's own draw; the vector stages add 4.
  const otherDraws =
    result.backend.calls.filter((call) => call.method === 'draw').length - draws.length;
  expect(stats.drawCalls).toBe(4 + otherDraws);
}

describe('vector analytic AA drawer acceptance', () => {
  it('draws count, edge strips, cover and cleanup once per run', async () => {
    const result = setup();
    await show(result);
    verifyFour(result, false);
  });

  it('draws the same four stages with retained move placement', async () => {
    const result = setup();
    await show(result);
    const table = new TransformTable(result.backend, 1);
    const indices = result.backend.createBuffer({
      usage: 'vertex',
      byteLength: 64,
      label: 'move-indices',
    });
    result.drawer().setMovePlacement({ table, indices, indexData: new Float32Array(16) });
    verifyFour(result, true);
    result.drawer().setMovePlacement(undefined);
    table.destroy();
  });
});
