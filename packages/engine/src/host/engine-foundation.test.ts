import { afterEach, describe, expect, it } from 'vitest';

import { MemoryLedger } from '../diagnostics/memory-ledger.js';
import { flushMicrotasks } from '../images/__fixtures__/manual-job-runner.js';
import { createFixtureAssetSource, fixtureAssetId } from '../images/fixture-asset-source.js';
import { NO_IMAGE_ASSETS } from '../images/image-pass-support.js';
import { MOBILE_BUDGET_BYTES } from '../memory/device-budget.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FontLibrary } from '../text/font/font-library.js';
import { createDecodeJobHandler } from '../workers/decode-job.js';

import { EngineFoundation } from './engine-foundation.js';

const MIB = 1024 * 1024;
const DESCRIBED = {
  mimeType: 'image/png',
  naturalSize: { width: 100, height: 100 },
  levels: [],
  tiles: null,
  averageColor: null,
  blurhash: null,
};
const foundations: EngineFoundation[] = [];

function foundationOf(...args: ConstructorParameters<typeof EngineFoundation>): EngineFoundation {
  const foundation = new EngineFoundation(...args);
  foundations.push(foundation);
  return foundation;
}

afterEach(() => {
  for (const foundation of foundations.splice(0)) foundation.destroy();
});

describe('EngineFoundation', () => {
  it('reports images idle until the image pass builds a texture manager, then as that is', () => {
    const plain = foundationOf(new FakeGpuBackend(), {}, {}, new MemoryLedger());
    expect(plain.isImageIdle).toBe(true);
    const foundation = foundationOf(
      new FakeGpuBackend(),
      {},
      { images: { assets: NO_IMAGE_ASSETS } },
      new MemoryLedger(),
    );
    expect(foundation.isImageIdle).toBe(true);
    let isIdle = false;
    const manager = {
      get isIdle() {
        return isIdle;
      },
    };
    foundation.environment.images?.onManager?.(manager as never);
    expect(foundation.isImageIdle).toBe(false);
    isIdle = true;
    expect(foundation.isImageIdle).toBe(true);
  });

  it('enables vector glyph resources by default and honors the host opt-out', () => {
    const extensions = { createTextResources: () => new FontLibrary() };
    const enabled = foundationOf(new FakeGpuBackend(), {}, extensions, new MemoryLedger());
    const disabled = foundationOf(
      new FakeGpuBackend(),
      { hasVectorGlyphs: false },
      extensions,
      new MemoryLedger(),
    );

    expect(enabled.environment.text?.hasVectorGlyphs).toBe(true);
    expect(disabled.environment.text?.hasVectorGlyphs).toBe(false);
  });

  it('builds the standard passes in order, the path mesh cache under the meshes share', () => {
    const foundation = foundationOf(new FakeGpuBackend(), {}, {}, new MemoryLedger());

    const passes = foundation.scenePasses(() => undefined);

    expect(passes.map(({ name }) => name)).toEqual([
      'frame-shadow',
      'solid-rect',
      'rect-gradient',
      'rect-image',
      'rounded-rect',
      'rounded-rect-gradient',
      'frame-stroke',
      'layer-composite',
      'sdf-shape',
      'sdf-shape-gradient',
      'sdf-shape-image',
      'link-preview',
      'link-icon',
      'image',
      'image-border',
      'path',
      'path-gradient',
      'connector',
      'text',
      'textVector',
      'sticky-author',
      'link-card-body',
      'link-card-footer',
      'frame-title',
    ]);
    expect(foundation.environment.budget.bytesByCategory.meshes).toBe(64 * MIB);
    expect(foundation.environment.images).toBeUndefined();
  });

  it('shares one device budget between textures and meshes, a phone getting less of each', () => {
    const device = { isMobile: true };
    const foundation = foundationOf(new FakeGpuBackend(), { device }, {}, new MemoryLedger());
    const { budget } = foundation.environment;

    expect(budget.totalBytes).toBe(MOBILE_BUDGET_BYTES);
    // A phone's glyph atlases take 10 64ths, its meshes 6; textures keep 34.
    expect(budget.bytesByCategory.meshes).toBe(12 * MIB);
    expect(budget.bytesByCategory.atlases).toBe(20 * MIB);
    expect(budget.bytesByCategory.textures).toBe(68 * MIB);
  });

  it('stops following the assets and closes the image support when destroyed', async () => {
    let listening = 0;
    const assets = {
      ...NO_IMAGE_ASSETS,
      describe: () => Promise.resolve(DESCRIBED),
      subscribe: () => {
        listening += 1;
        return () => {
          listening -= 1;
        };
      },
    };
    let closed = 0;
    const images = {
      assets,
      close: () => {
        closed += 1;
      },
    };
    const foundation = new EngineFoundation(
      new FakeGpuBackend(),
      {},
      { images },
      new MemoryLedger(),
    );
    const catalogue = foundation.environment.images?.catalogue;
    const assetId = fixtureAssetId('photo');
    const entry = catalogue?.entry(assetId);
    await flushMicrotasks();
    const pixels = { widthPx: 100, heightPx: 100, rgba: new Uint8Array(40_000) };
    catalogue?.keepSmallest(
      { kind: 'client', assetId, longEdgePx: 100, mimeType: 'image/png' },
      pixels,
    );
    expect(entry?.smallest).toBe(pixels);
    const whileAlive = [listening, closed];

    foundation.destroy();

    expect(entry?.smallest).toBeUndefined();
    expect([whileAlive, [listening, closed]]).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it('decodes on this thread only when given a decode fallback', async () => {
    const assetId = fixtureAssetId('photo');
    const assets = createFixtureAssetSource(1, {
      assets: { [assetId]: { naturalSize: { width: 1000, height: 800 } } },
    });
    const bytes = await assets.fetchLevel(assetId, 128);
    const request = { assetId, bytes, mimeType: '', longEdgesPx: [128] };
    const ledger = new MemoryLedger();
    const without = foundationOf(new FakeGpuBackend(), {}, { images: { assets } }, ledger);
    const decodeFallback = createDecodeJobHandler();
    const images = { assets: NO_IMAGE_ASSETS, decodeFallback };
    const withFallback = foundationOf(new FakeGpuBackend(), {}, { images }, ledger);

    const refused = without.jobs.pool.submit('decode', request, { priority: 'visible' });
    const decoded = withFallback.jobs.pool.submit(
      'decode',
      { ...request, bytes: bytes.slice(0) },
      { priority: 'visible' },
    );
    without.jobs.runQueued(() => 0);
    withFallback.jobs.runQueued(() => 0);

    await expect(refused.response).rejects.toThrow(/no handler/i);
    expect((await decoded.response).levels[0]).toMatchObject({ widthPx: 128 });
    expect(without.environment.images).toBeDefined();
  });

  it("follows a rebuilt backend's texture limit: the budget and the images' levels", async () => {
    const assetId = fixtureAssetId('photo');
    const assets = createFixtureAssetSource(1, {
      assets: { [assetId]: { naturalSize: { width: 3000, height: 2000 } } },
    });
    const foundation = foundationOf(
      new FakeGpuBackend({ maxTextureSize: 8192 }),
      {},
      { images: { assets } },
      new MemoryLedger(),
    );
    const entry = foundation.environment.images?.catalogue.entry(assetId);
    await flushMicrotasks();
    expect(entry?.levels).toEqual([128, 512, 2048, 3000]);
    const before = foundation.environment.budget.totalBytes;

    foundation.adoptBackend(new FakeGpuBackend({ maxTextureSize: 2048 }));

    expect(entry?.levels).toEqual([128, 512, 2048]);
    expect(foundation.environment.budget.totalBytes).toBeLessThan(before);
  });

  it('reports once through the fault channel that no job worker can decode images', async () => {
    const faults: Error[] = [];
    const assets = createFixtureAssetSource(1);
    const foundation = foundationOf(
      new FakeGpuBackend(),
      {},
      { images: { assets } },
      new MemoryLedger(),
      (error) => faults.push(error),
    );
    const support = foundation.environment.images;

    support?.reportDecoderMissing(new Error('No handler is registered for "decode" jobs.'));
    support?.reportDecoderMissing(new Error('No handler is registered for "decode" jobs.'));
    await flushMicrotasks();

    expect(faults.map(({ message }) => message.slice(0, 26))).toEqual([
      'Images cannot be decoded: ',
    ]);
  });
});
