import { describe, expect, it, vi } from 'vitest';

import {
  createWebWorkerTransport,
  type WebWorkerEntry,
} from '../workers/web-worker/web-worker-transport.js';

import type { EngineHostPlatform } from './engine-host-platform.js';
import { createEngineWorkerEntry } from './engine-worker-entry.js';
import { createBrowserHostPlatform } from './web/browser-host-platform.js';
import type { EngineWorkerTransport } from './worker-engine-host.js';

// Only the shapes matter here; the real backends are the golden scenes' business.
vi.mock('../gpu/create-gpu-backend.js', () => ({ createGpuBackend: vi.fn() }));

// The browser adapters live in projects that cannot import the core, so they restate its shapes;
// these assignments fail to type-check if the two drift apart.

describe('the browser adapters of the engine host', () => {
  it('fit the shapes the core expects', () => {
    const scope = {
      performance: { timeOrigin: 0, now: () => 0 },
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    };
    const platform: EngineHostPlatform = createBrowserHostPlatform(scope);
    const entry: WebWorkerEntry = createEngineWorkerEntry(platform);
    const spawn: (worker: Parameters<typeof createWebWorkerTransport>[0]) => EngineWorkerTransport =
      createWebWorkerTransport;
    expect([typeof platform.createBackend, typeof entry.onMessage, typeof spawn]).toEqual([
      'function',
      'function',
      'function',
    ]);
  });
});
