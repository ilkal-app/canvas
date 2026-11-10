import { describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({
  entry: { name: 'entry' },
  handlers: { name: 'shipped handlers' },
  bitmaps: { name: 'bitmaps' },
  colourCanvas: { name: 'colour canvas' },
  served: [] as unknown[][],
  bitmapScopes: [] as unknown[],
  colourScopes: [] as unknown[],
  handlerOptions: [] as unknown[],
  registered: [] as unknown[],
}));

vi.mock('@canvas/engine', () => ({
  createBrowserBitmapFactory: (scope: unknown) => {
    engine.bitmapScopes.push(scope);
    return engine.bitmaps;
  },
  createBrowserColourCanvas: (scope: unknown) => {
    engine.colourScopes.push(scope);
    return engine.colourCanvas;
  },
  createProductionJobHandlers: (options: unknown) => {
    engine.handlerOptions.push(options);
    return engine.handlers;
  },
  createWorkerEntry: (handlers: unknown) => {
    engine.registered.push(handlers);
    return engine.entry;
  },
  serveWorkerEntry: (...args: unknown[]) => engine.served.push(args),
}));

describe('the job worker script', () => {
  it("serves the engine's shipped job handlers, without echo, on its own scope, decoding with its createImageBitmap and drawing colour glyphs on its OffscreenCanvas", async () => {
    vi.stubGlobal('self', globalThis);
    await import('./job-worker.js');
    expect(engine.bitmapScopes).toEqual([globalThis]);
    expect(engine.colourScopes).toEqual([globalThis]);
    expect(engine.handlerOptions).toEqual([
      { bitmaps: engine.bitmaps, colourCanvas: engine.colourCanvas },
    ]);
    expect(engine.registered).toEqual([engine.handlers]);
    expect(engine.served).toEqual([[globalThis, engine.entry]]);
    vi.unstubAllGlobals();
  });
});
