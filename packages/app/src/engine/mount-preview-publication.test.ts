// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { createLargeBoardObjects, SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { PreviewRequest } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import { readCachedProjection } from '../collab/cached-projection.js';
import type * as PageFonts from '../text-input/page-fonts.js';

import { mountOnFakeHost } from './__fixtures__/fake-engine-host.js';

vi.mock('../text-input/page-fonts.js', async (original) => ({
  ...(await original<typeof PageFonts>()),
  pageTextFonts: () => ({ contentIdentity: 'font-content' }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('flushes a queued peer object before reading the publication scene stamp', async () => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  const store = new YjsDocumentStore();
  const note = createLargeBoardObjects(100, 126).find((object) => object.type === 'sticky');
  if (note === undefined) throw new Error('fixture needs a note');
  const first = { ...note, id: 'first' as ObjectId, parentId: null };
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    transaction.setObject(first);
  });
  const { host, engine } = await mountOnFakeHost({ options: { store } });
  try {
    const added = { ...first, id: 'peer-note' as ObjectId, x: 0, y: 0 };
    const before = host.changeSets.length;
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject(added);
    });
    expect(host.changeSets).toHaveLength(before);
    const read = vi.fn((request: PreviewRequest) =>
      Promise.resolve({
        ...request,
        candidates: [
          ...new Set(host.changeSets.flatMap((change) => Object.keys(change.objects))),
        ] as ObjectId[],
        assets: [],
        imagePlanKey: '[]',
        lodPlanKey: '[]',
        frameIndex: 1,
        resourceGeneration: 0,
      }),
    );
    Object.assign(host, { readPreviewCertificate: read });
    const bytes = await engine.prepareSnapshotPreview?.('board');
    expect(read).toHaveBeenCalledTimes(1);
    expect(host.changeSets.at(-1)?.created).toContain(added.id);
    expect(bytes?.byteLength).toBeGreaterThan(0);
    const cached =
      bytes &&
      readCachedProjection(bytes, {
        boardId: 'board',
        camera: engine.camera(),
        fontSetKey: 'font-content',
      });
    expect(cached?.board.objects.get(added.id)).toEqual({ ...added, pageId: 'page-1' });
  } finally {
    engine.destroy();
    store.destroy();
  }
});
