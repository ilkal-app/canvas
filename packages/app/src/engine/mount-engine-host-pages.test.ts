// @vitest-environment jsdom
// The engine host mount's pages, trace tint and image picker against a fake host. In
// Chrome: tooling/scenario/specs/app/pages-panel.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageId } from '@canvas/schema';

import { NO_IMAGES_MESSAGE } from '../assets/page-images.js';

import { mountOnFakeHost } from './__fixtures__/fake-engine-host.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('createEngineHostMount pages, trace tint and images', () => {
  it('shows a page at its own camera at once, sending the host the camera', async () => {
    const { host, engine } = await mountOnFakeHost();
    const pages = engine.pages;
    if (pages === undefined) throw new Error('the mount has pages');
    const added = pages.run('addPage', {}) as { pageId: PageId };
    pages.show(added.pageId);
    host.calls.length = 0;
    pages.show('page-1' as PageId);
    expect(host.calls).toContainEqual(['setCamera', 1]);
    expect(engine.camera()).toMatchObject({ x: 0, y: 0, zoom: 1 });
  });

  it('sends the host a trace tint as an overlay layer', async () => {
    const { host, engine } = await mountOnFakeHost();
    const before = host.overlays.length;
    engine.showTraceTint?.({ sheets: [] });
    engine.inspect();
    expect(host.overlays.length).toBeGreaterThan(before);
  });

  it('tells the person when the image tool opens on a page that takes no images', async () => {
    const onNotice = vi.fn();
    const { engine } = await mountOnFakeHost({ options: { onNotice } });
    engine.setActiveTool('image');
    await vi.waitFor(() => {
      expect(onNotice).toHaveBeenCalledWith(NO_IMAGES_MESSAGE);
    });
  });
});
