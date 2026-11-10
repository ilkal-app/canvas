import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { INK_COLORS, type ObjectId } from '@canvas/schema';

import { preloadLayoutShaper } from '../layout/layout-job.js';

import { CAMERA, createTextSetUp, STYLE, textObject } from './__fixtures__/text-objects.js';
import { TEXT_PASS } from './text-pass.js';
import { TEXT_VECTOR_PASS, TEXT_VECTOR_PASS_NAME } from './text-vector-pass.js';

const HIGH_CAMERA = { ...CAMERA, zoom: 32 };
const ID = 'linked-vector-text' as ObjectId;
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

describe('a linked run at the vector tier', () => {
  it("draws a linked ink run's outlines in ink, as its atlas glyphs and underline do", async () => {
    const setup = createTextSetUp(
      HIGH_CAMERA,
      true,
      false,
      { passes: [TEXT_PASS, TEXT_VECTOR_PASS] },
      { hasVectorGlyphs: true },
    );
    live.push(setup);
    setup.renderer.setTheme('dark');
    setup.document.create(
      textObject(ID, 'AB', {
        runs: [
          { length: 1, style: { ...STYLE, color: 'ink', link: 'https://example.com/a' } },
          { length: 1, style: { ...STYLE, color: 'ink' } },
        ],
      }),
    );
    setup.renderer.enqueue(setup.document.takeChanges());
    await setup.settle();
    const buffer = setup.renderer.scene.instanceBufferOf(TEXT_VECTOR_PASS_NAME);
    const stride = buffer.layout.floatsPerRecord;
    const colours = Array.from({ length: buffer.recordCount }, (ignored, slot) => [
      ...buffer.data.slice(slot * stride + 4, slot * stride + 8),
    ]);
    expect(colours[0]).toEqual(INK_COLORS.dark.map(Math.fround));
    expect(colours[1]).toEqual(colours[0]);
  });
});
