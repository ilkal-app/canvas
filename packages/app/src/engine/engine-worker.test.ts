import { describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({
  platform: { name: 'platform' },
  entry: { name: 'entry' },
  served: [] as unknown[][],
  platformScopes: [] as unknown[],
  extensions: [] as unknown[],
  createOverlay: () => undefined,
  images: { name: 'images' },
}));

vi.mock('@canvas/engine', () => ({
  createBrowserHostPlatform: (scope: unknown) => {
    engine.platformScopes.push(scope);
    return engine.platform;
  },
  createEngineWorkerEntry: (platform: unknown, extensions: unknown) => {
    engine.extensions.push(extensions);
    return platform === engine.platform ? engine.entry : undefined;
  },
  serveWorkerEntry: (...args: unknown[]) => engine.served.push(args),
  chooseWorkerCount: () => 3,
  detectWorkerEnvironment: () => ({ hasWorkers: true, hardwareConcurrency: 4 }),
  createWebWorkerTransport: (worker: unknown) => worker,
  FontLibrary: class {
    readonly name = 'fonts';
  },
}));

vi.mock('../text-input/worker-font-files.js', () => ({
  withFontFiles: (entry: unknown, fonts: unknown) => ({ entry, fonts }),
}));

vi.mock('./shell-overlay.js', () => ({
  createShellOverlay: engine.createOverlay,
}));

vi.mock('./image-support.js', () => ({
  createImageSupport: () => engine.images,
}));

describe('the engine worker script', () => {
  it("serves the engine's worker entry on its own scope, with the browser platform, the shell's overlay, a font library the page's files fill, and image support", async () => {
    vi.stubGlobal('self', globalThis);
    await import('./engine-worker.js');
    expect(engine.platformScopes).toEqual([globalThis]);
    expect(engine.extensions).toMatchObject([
      { createOverlay: engine.createOverlay, jobWorkers: { count: 3 } },
    ]);
    expect(engine.extensions).toHaveLength(1);
    const { createImages } = engine.extensions[0] as {
      createImages: (channel?: object) => unknown;
    };
    expect(createImages({ port: 1 })).toBe(engine.images);
    const { createTextResources } = engine.extensions[0] as { createTextResources: () => unknown };
    expect(engine.served).toEqual([
      [globalThis, { entry: engine.entry, fonts: createTextResources() }],
    ]);
    expect(createTextResources()).toEqual({ name: 'fonts' });
    vi.unstubAllGlobals();
  });
});
