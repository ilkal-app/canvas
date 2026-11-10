import { expect, it, vi } from 'vitest';

import { createLargeBoardObjects } from '@canvas/document';
import { visibleWorldBounds, type EngineHost, type PreviewCertificate } from '@canvas/engine';
import { createBoard } from '@canvas/schema';

import { enqueueHostScene, readHostSceneStamp } from '../engine/host-scene-stream.js';

import { readCachedProjection } from './cached-projection.js';
import { captureCachedProjection } from './capture-cached-projection.js';

function setup() {
  const board = createBoard(
    createLargeBoardObjects(10, 126).filter((object) => object.type !== 'image'),
  );
  const camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 100, dpr: 1 };
  let answer: (value: PreviewCertificate | undefined) => void = () => undefined;
  const reply = new Promise<PreviewCertificate | undefined>((resolve) => {
    answer = resolve;
  });
  const host = {
    applyChangeSet: vi.fn(),
    readPreviewCertificate: vi.fn(() => reply),
  } as unknown as EngineHost;
  const scene = enqueueHostScene(host, { created: [], updated: [], deleted: [], objects: {} });
  const certificate: PreviewCertificate = {
    scene,
    camera,
    coverage: visibleWorldBounds(camera),
    fontSetKey: 'font-sha',
    candidates: [...board.objects.keys()],
    assets: [],
    imagePlanKey: '[]',
    lodPlanKey: '[]',
    frameIndex: 0,
    resourceGeneration: 0,
  };
  return { board, camera, host, answer, certificate };
}

it('captures bytes only when the drawn source still matches the authoritative snapshot view', async () => {
  const { board, camera, host, answer, certificate } = setup();
  const identity = { boardId: 'board', camera, fontSetKey: 'font-sha' };
  const result = captureCachedProjection(host, { ...identity, board, isCurrent: () => true });
  answer(certificate);
  const bytes = await result;
  expect(bytes).toBeInstanceOf(Uint8Array);
  expect(bytes === undefined ? undefined : readCachedProjection(bytes, identity)?.board).toEqual({
    ...board,
    // The projection keeps the board's pages: the default page here.
    pages: expect.any(Map) as unknown,
  });
});

it.each(['document', 'scene', 'certificate', 'camera', 'font', 'candidate'] as const)(
  'refuses %s changes during certification',
  async (change) => {
    const { board, camera, host, answer, certificate } = setup();
    let isCurrent = true;
    const result = captureCachedProjection(host, {
      boardId: 'board',
      camera,
      fontSetKey: 'font-sha',
      board,
      isCurrent: () => isCurrent,
    });
    if (change === 'document') isCurrent = false;
    if (change === 'scene')
      enqueueHostScene(host, { created: [], updated: [], deleted: [], objects: {} });
    answer(
      change === 'camera'
        ? { ...certificate, camera: { ...camera, dpr: 2 } }
        : change === 'font'
          ? { ...certificate, fontSetKey: 'changed' }
          : change === 'candidate'
            ? { ...certificate, candidates: ['missing' as (typeof certificate.candidates)[number]] }
            : change === 'certificate'
              ? { ...certificate, scene: { ...certificate.scene, sequence: 7 } }
              : certificate,
    );
    await expect(result).resolves.toBeUndefined();
    expect(readHostSceneStamp(host)).toBeDefined();
  },
);
