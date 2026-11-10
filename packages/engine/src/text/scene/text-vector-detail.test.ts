import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { preloadLayoutShaper } from '../layout/layout-job.js';

import { CAMERA, createTextSetUp, textObject } from './__fixtures__/text-objects.js';
import { TEXT_PASS } from './text-pass.js';
import { TEXT_VECTOR_PASS, TEXT_VECTOR_PASS_NAME } from './text-vector-pass.js';

const ID = 'big' as ObjectId;
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

describe('the text vector companion level of detail', () => {
  it('leaves small text out of its segments, and text that can draw from outlines in', async () => {
    const setup = createTextSetUp(
      CAMERA,
      true,
      true,
      { passes: [TEXT_PASS, TEXT_VECTOR_PASS] },
      { hasVectorGlyphs: true },
    );
    live.push(setup);
    setup.document.create(textObject(ID, 'A'));
    setup.renderer.enqueue(setup.document.takeChanges());
    // 20 px text at 1×: a 24 px line, far under the companion's 400 px.
    await setup.settle(12, CAMERA);
    const { levelOfDetail } = setup.renderer.scene;
    expect(levelOfDetail.hiddenIn(TEXT_VECTOR_PASS_NAME).has(ID)).toBe(true);
    // At 32× (a 768 px line, 640 px per em: the vector tier) it is drawn, and draws from outlines.
    await setup.settle(24, { ...CAMERA, zoom: 32 });
    expect(levelOfDetail.hiddenIn(TEXT_VECTOR_PASS_NAME).has(ID)).toBe(false);
    setup.backend.resetCalls();
    const stats = setup.renderer.renderFrame({ timeMs: 9000, camera: { ...CAMERA, zoom: 32 } });
    expect(stats.vectorTextRuns).toBe(1);
  });

  it('keeps drawing from the atlas what the companion still hides while its changes are budgeted', async () => {
    const setup = createTextSetUp(
      CAMERA,
      true,
      true,
      { passes: [TEXT_PASS, TEXT_VECTOR_PASS], churnBudget: { lodChangesPerFrame: 1 } },
      { hasVectorGlyphs: true },
    );
    live.push(setup);
    const ids = ['a', 'b', 'c'] as ObjectId[];
    setup.document.create(...ids.map((id, index) => textObject(id, 'A', { x: index * 2 })));
    setup.renderer.enqueue(setup.document.takeChanges());
    const { scene } = setup.renderer;
    const high = { ...CAMERA, zoom: 32 };
    // The outlines are fetched once at 32×; back at 1× the companion hides the text again, so the
    // jump below finds every run's geometry ready while the companion's changes wait their turn.
    const frames = async (count: number, camera: typeof CAMERA): Promise<void> => {
      for (let frame = 0; frame < count; frame += 1) {
        setup.renderer.renderFrame({ timeMs: frame * 16, camera });
        setup.pool.drainMainThread(1_000, () => 0);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    await setup.settle(24, CAMERA);
    await frames(30, high);
    await frames(30, CAMERA);
    for (const id of ids)
      expect(scene.levelOfDetail.hiddenIn(TEXT_VECTOR_PASS_NAME).has(id)).toBe(true);
    let hiddenFrames = 0;
    for (let frame = 0; frame < 40; frame += 1) {
      setup.renderer.renderFrame({ timeMs: 9000 + frame * 16, camera: high });
      setup.pool.drainMainThread(1_000, () => 0);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const records = setup.records();
      for (const id of ids) {
        if (!scene.levelOfDetail.hiddenIn(TEXT_VECTOR_PASS_NAME).has(id)) continue;
        hiddenFrames += 1;
        // Hidden by the companion: its glyphs must still draw from the atlas.
        const drawn = scene.slotsOf(id, 'text').map((slot) => (records[slot]?.[6] ?? 0) > 0);
        expect(drawn).toEqual(drawn.map(() => true));
      }
    }
    // The budget held some text back for a few frames, and at the end all of it is in the companion.
    expect(hiddenFrames).toBeGreaterThan(0);
    for (const id of ids)
      expect(scene.levelOfDetail.hiddenIn(TEXT_VECTOR_PASS_NAME).has(id)).toBe(false);
  });
});
