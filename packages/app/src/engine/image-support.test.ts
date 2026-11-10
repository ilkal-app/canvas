import { afterEach, describe, expect, it, vi } from 'vitest';

import { NO_IMAGE_ASSETS } from '@canvas/engine';

import { createImageSupport } from './image-support.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createImageSupport', () => {
  it('gives the engine the app assets and no decode fallback, so no rendering thread decodes', () => {
    vi.stubEnv('VITE_CANVAS_HARNESS', '');

    expect(createImageSupport()).toEqual({ assets: NO_IMAGE_ASSETS });
  });

  it('serves synthetic images in harness builds, and closes its channel when asked', async () => {
    vi.stubEnv('VITE_CANVAS_HARNESS', '1');
    const support = createImageSupport();

    const info = await support.assets.describe('asset-1' as never);
    support.close?.();

    expect(info.naturalSize?.width).toBeGreaterThan(0);
  });

  it('serves the assets service over the page’s port, the fallback while the page has none', async () => {
    vi.stubEnv('VITE_CANVAS_HARNESS', '');
    const channel = new MessageChannel();
    const support = createImageSupport(channel.port2);
    const requests: unknown[] = [];
    channel.port1.onmessage = (event: MessageEvent) => {
      requests.push(event.data);
      channel.port1.postMessage({ type: 'access', access: null });
    };
    await expect(support.assets.describe('asset-1' as never)).rejects.toThrow('No asset source');
    expect(requests).toEqual([{ type: 'access-request' }]);
    support.close?.();
    channel.port1.close();
  });

  it('closes the harness fallback with the linked support', () => {
    vi.stubEnv('VITE_CANVAS_HARNESS', '1');
    const channel = new MessageChannel();
    const support = createImageSupport(channel.port2);
    support.close?.();
    channel.port1.close();
    expect(createImageSupport({ not: 'a port' }).assets).toBeDefined();
  });
});
