import { describe, expect, it, vi } from 'vitest';

import type { EngineHost } from '@canvas/engine';

import {
  chooseDefaultMount,
  createDefaultMount,
  mountDefaultEngine,
} from './mount-default-engine.js';

const probe = vi.hoisted(() => ({
  canRenderInWorker: false,
  probes: 0,
  started: [] as string[],
}));

vi.mock('./start-browser-host.js', () => ({
  browserHostPlatform: () => ({
    canRenderInWorker: () => {
      probe.probes += 1;
      return probe.canRenderInWorker;
    },
  }),
  startBrowserHost: (canvas: unknown, prefer: string) => {
    probe.started.push(prefer);
    return new Promise<EngineHost>(() => undefined);
  },
}));

const VIEWPORT = { cssWidthPx: 4, cssHeightPx: 2, widthPx: 4, heightPx: 2, dpr: 1 };

function canvas(): HTMLCanvasElement {
  const listeners = { addEventListener: () => undefined, removeEventListener: () => undefined };
  return { ...listeners, width: 4, height: 2, clientWidth: 4, clientHeight: 2 } as never;
}

describe('chooseDefaultMount', () => {
  it('runs the engine host mount either way: in the worker where it can render, else on the main thread', () => {
    const workerMount = chooseDefaultMount(true);
    expect(chooseDefaultMount(true)).toBe(workerMount);
    expect(chooseDefaultMount(false)).not.toBe(workerMount);
  });
});

describe('createDefaultMount', () => {
  it('asks its probe on each mount and starts the host where the answer says', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    probe.started.length = 0;
    createDefaultMount(() => true)(canvas(), { viewport: VIEWPORT }).destroy();
    createDefaultMount(() => false)(canvas(), { viewport: VIEWPORT }).destroy();
    expect(probe.started).toEqual(['worker', 'main']);
    vi.unstubAllGlobals();
  });
});

describe('mountDefaultEngine', () => {
  it("asks the page's platform whether a worker can render", () => {
    probe.started.length = 0;
    mountDefaultEngine(canvas(), { viewport: VIEWPORT }).destroy();
    expect(probe.probes).toBe(1);
    expect(probe.started).toEqual(['main']);
  });
});
