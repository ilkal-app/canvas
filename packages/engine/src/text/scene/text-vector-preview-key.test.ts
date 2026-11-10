import { afterEach, beforeAll, expect, it } from 'vitest';

import { visibleWorldBounds } from '../../camera/camera.js';
import { SpatialCuller } from '../../spatial/spatial-culler.js';
import { preloadLayoutShaper } from '../layout/layout-job.js';

import { CAMERA, createTextSetUp, textObject } from './__fixtures__/text-objects.js';
import { TEXT_PASS } from './text-pass.js';
import { TEXT_VECTOR_PASS } from './text-vector-pass.js';

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
 * Settles a renderer with the text and its vector companion over the given texts.
 *
 * @param texts - The texts.
 * @returns The set-up, with its font set's key.
 */
async function settled(...texts: ReturnType<typeof textObject>[]) {
  const setup = createTextSetUp(
    CAMERA,
    true,
    true,
    { passes: [TEXT_PASS, TEXT_VECTOR_PASS], culler: new SpatialCuller() },
    { hasVectorGlyphs: true },
  );
  live.push(setup);
  const key = await setup.fonts.prepareContentIdentity(setup.fonts.faces);
  if (key === undefined) throw new Error('Missing font identity');
  setup.document.create(...texts);
  setup.renderer.enqueue(setup.document.takeChanges());
  await setup.settle(24, CAMERA);
  return { ...setup, key };
}

it("keys a preview's level of detail by what it holds, not the padded view", async () => {
  // The vector companion hides all small text, a non-full form the key records. Text in
  // the culler's padding band is visible to the live board but outside the coverage, so it is
  // never in the projection; keyed, the reopened preview could never match its certificate.
  const inView = textObject('in', 'A');
  const board = await settled(inView, textObject('band', 'B', { x: 450 }));
  const preview = await settled(inView);
  expect(board.renderer.scene.levelOfDetail.visibleIds).toContain('band');
  const coverage = visibleWorldBounds(CAMERA);
  const keyOf = ({ renderer, key }: Awaited<ReturnType<typeof settled>>): string | undefined => {
    const candidates = renderer.projectionCandidates(coverage);
    if (candidates === undefined) throw new Error('Missing candidates');
    return renderer.readPreviewResources(CAMERA, key, candidates)?.lodPlanKey;
  };
  expect(board.renderer.projectionCandidates(coverage)).toEqual(['in']);
  expect(keyOf(board)).toBeDefined();
  expect(keyOf(board)).toBe(keyOf(preview));
});
