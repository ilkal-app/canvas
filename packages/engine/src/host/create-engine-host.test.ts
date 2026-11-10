import { describe, expect, it, vi } from 'vitest';

import { NO_IMAGE_ASSETS } from '../images/image-pass-support.js';
import { FontLibrary } from '../text/font/font-library.js';
import type { FontFaceSource } from '../text/scene/text-pass-resources.js';
import { FakeWorkerTransport } from '../workers/__fixtures__/fake-worker-transport.js';

import { FakeCanvas, FakeHostPlatform } from './__fixtures__/fake-host-platform.js';
import { InMemoryEngineWorker, settle } from './__fixtures__/in-memory-engine-worker.js';
import { recordingOverlays } from './__fixtures__/recording-overlay.js';
import { chooseEngineHostKind, createEngineHost } from './create-engine-host.js';
import type { EngineImageSupport } from './engine-extensions.js';
import type { EngineHost } from './engine-host.js';

async function create(
  platform: FakeHostPlatform,
  canvas: FakeCanvas,
  options: Partial<Parameters<typeof createEngineHost>[1]> = {},
): Promise<EngineHost> {
  const host = createEngineHost(canvas, { platform, ...options });
  await settle();
  return host;
}

describe('chooseEngineHostKind', () => {
  it('runs in a worker only when preferred, supported and a worker can be spawned', () => {
    const everything = { canRenderInWorker: true, canSpawnWorker: true };
    expect(chooseEngineHostKind('worker', everything)).toBe('worker');
    expect(chooseEngineHostKind('main', everything)).toBe('main');
    expect(chooseEngineHostKind('worker', { ...everything, canRenderInWorker: false })).toBe(
      'main',
    );
    expect(chooseEngineHostKind('worker', { ...everything, canSpawnWorker: false })).toBe('main');
  });
});

describe('createEngineHost', () => {
  it('hands the canvas to a spawned worker by default', async () => {
    const platform = new FakeHostPlatform();
    const canvas = new FakeCanvas();
    const worker = new InMemoryEngineWorker();
    const host = await create(platform, canvas, { spawnWorker: () => worker, sampleCount: 1 });
    expect(host.kind).toBe('worker');
    expect(canvas.isTransferred).toBe(true);
    expect(worker.platform.backendOptions).toEqual([{ prefer: 'webgpu', sampleCount: 1 }]);
    expect(platform.backends).toEqual([]);
  });

  it('falls back to the main thread when the browser cannot render in a worker', async () => {
    const platform = new FakeHostPlatform();
    platform.isWorkerRenderingSupported = false;
    const canvas = new FakeCanvas();
    let spawned = 0;
    const host = await create(platform, canvas, {
      spawnWorker: () => {
        spawned += 1;
        return new InMemoryEngineWorker();
      },
    });
    expect(host.kind).toBe('main');
    expect(spawned).toBe(0);
    expect(canvas.isTransferred).toBe(false);
  });

  it('runs on the main thread when asked, or when no worker can be spawned', async () => {
    const platform = new FakeHostPlatform();
    const worker = new InMemoryEngineWorker();
    expect(
      (await create(platform, new FakeCanvas(), { prefer: 'main', spawnWorker: () => worker }))
        .kind,
    ).toBe('main');
    expect((await create(platform, new FakeCanvas())).kind).toBe('main');
  });

  it('gives a main-thread host the overlay layer, and keeps the function off a worker message', async () => {
    const platform = new FakeHostPlatform();
    const overlays = recordingOverlays();
    await create(platform, new FakeCanvas(), { prefer: 'main', createOverlay: overlays.create });
    expect(overlays.layers).toHaveLength(1);
    const worker = new InMemoryEngineWorker();
    await create(platform, new FakeCanvas(), {
      spawnWorker: () => worker,
      createOverlay: overlays.create,
    });
    expect(worker.received[0]).toMatchObject({ type: 'engine-init', options: {} });
    expect(overlays.layers).toHaveLength(1);
  });

  it('gives a main-thread host its text resources and job workers, from the host options’ fonts', async () => {
    const face: FontFaceSource = { family: 'F', weight: 400, isItalic: false, url: 'data:,' };
    const createTextResources = vi.fn(() => new FontLibrary());
    const spawn = vi.fn();
    const host = await create(new FakeHostPlatform(), new FakeCanvas(), {
      prefer: 'main',
      fontFaces: [face],
      createTextResources,
      jobWorkers: { count: 0, spawn },
    });
    expect(host.kind).toBe('main');
    expect(createTextResources.mock.calls).toEqual([[[face]]]);
    expect(spawn).not.toHaveBeenCalled();
    host.destroy();
  });

  it('stops every job worker it started, so ten mounts of a main-thread host leave none running', async () => {
    const spawned: FakeWorkerTransport[] = [];
    const spawn = (): FakeWorkerTransport => {
      const transport = new FakeWorkerTransport();
      spawned.push(transport);
      return transport;
    };
    for (let mount = 0; mount < 10; mount += 1) {
      const host = await create(new FakeHostPlatform(), new FakeCanvas(), {
        prefer: 'main',
        createTextResources: () => new FontLibrary(),
        jobWorkers: { count: 2, spawn },
      });
      host.destroy();
    }
    // One pool per engine: two workers a mount, the text pass's jobs among theirs.
    expect(spawned).toHaveLength(20);
    expect(spawned.filter((transport) => !transport.isTerminated)).toEqual([]);
  });

  it('creates the image support only for a main-thread host, and closes it with the host', async () => {
    const platform = new FakeHostPlatform();
    let created = 0;
    let closed = 0;
    const createImages = (): EngineImageSupport => {
      created += 1;
      return {
        assets: NO_IMAGE_ASSETS,
        close: () => {
          closed += 1;
        },
      };
    };
    const worker = new InMemoryEngineWorker();
    const inWorker = await create(platform, new FakeCanvas(), {
      spawnWorker: () => worker,
      createImages,
    });
    expect([inWorker.kind, created]).toEqual(['worker', 0]);

    const onMain = await create(platform, new FakeCanvas(), { prefer: 'main', createImages });
    expect([onMain.kind, created, closed]).toEqual(['main', 1, 0]);
    onMain.destroy();

    expect(closed).toBe(1);
  });

  it('hands the image channel to the worker script’s createImages, transferred with the canvas', async () => {
    const platform = new FakeHostPlatform();
    const channels: (object | undefined)[] = [];
    const worker = new InMemoryEngineWorker(1_000_500, {
      createImages: (channel) => {
        channels.push(channel);
        return { assets: NO_IMAGE_ASSETS };
      },
    });
    const imageChannel = { port: 'images' };
    const pageSide: (object | undefined)[] = [];
    const host = await create(platform, new FakeCanvas(), {
      spawnWorker: () => worker,
      imageChannel,
      createImages: (channel) => {
        pageSide.push(channel);
        return { assets: NO_IMAGE_ASSETS };
      },
    });
    expect(host.kind).toBe('worker');
    expect(channels).toEqual([{ port: 'images' }]);
    expect(pageSide).toEqual([]);
    expect(worker.transfers[0]).toHaveLength(2);
    expect(worker.transfers[0]?.[1]).toBe(imageChannel);
  });

  it('gives a main-thread host’s createImages the image channel itself', async () => {
    const platform = new FakeHostPlatform();
    const imageChannel = { port: 'images' };
    const channels: (object | undefined)[] = [];
    await create(platform, new FakeCanvas(), {
      prefer: 'main',
      imageChannel,
      createImages: (channel) => {
        channels.push(channel);
        return { assets: NO_IMAGE_ASSETS };
      },
    });
    expect(channels).toEqual([imageChannel]);
    expect(channels[0]).toBe(imageChannel);
  });

  it('falls back, keeping the canvas, when spawning fails, and terminates a worker the canvas could not reach', async () => {
    const platform = new FakeHostPlatform();
    const failedSpawn = await create(platform, new FakeCanvas(), {
      spawnWorker: () => {
        throw new Error('no worker URL');
      },
    });
    expect(failedSpawn.kind).toBe('main');
    const alreadyTransferred = new FakeCanvas();
    alreadyTransferred.isTransferred = true;
    const worker = new InMemoryEngineWorker();
    const failedTransfer = await create(platform, alreadyTransferred, {
      spawnWorker: () => worker,
    });
    expect(failedTransfer.kind).toBe('main');
    expect(worker.isTerminated).toBe(true);
  });

  it('rejects, without falling back, when the worker fails after the hand-over', async () => {
    const platform = new FakeHostPlatform();
    const canvas = new FakeCanvas();
    const worker = new InMemoryEngineWorker();
    worker.platform.backendFailure = new Error('no GPU in the worker');
    await expect(create(platform, canvas, { spawnWorker: () => worker })).rejects.toThrow(
      'no GPU in the worker',
    );
    expect(platform.backends).toEqual([]);
  });
});
