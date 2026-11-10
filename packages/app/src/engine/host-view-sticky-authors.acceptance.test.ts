// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import type { EngineHost, StickyAuthors } from '@canvas/engine';

import { FakeHost, mountOnFakeHost } from './__fixtures__/fake-engine-host.js';
import { hostView } from './host-view.js';

describe('host view sticky author forwarding', () => {
  it('forwards MountedEngine.setStickyAuthors through the mounted view', async () => {
    const { engine, host, canvas } = await mountOnFakeHost();
    const setStickyAuthors = vi.fn<(authors: StickyAuthors) => void>();
    Object.assign(host, { setStickyAuthors });
    const authors: StickyAuthors = {
      isShown: true,
      names: new Map([['user:ada', 'Ada']]),
      fallback: 'Former member',
    };

    engine.setStickyAuthors(authors);
    expect(setStickyAuthors).toHaveBeenCalledExactlyOnceWith(authors);
    engine.destroy();
    canvas.remove();
  });

  it('sends the exact names straight to the host and sends nothing after destruction', () => {
    const setStickyAuthors = vi.fn<(authors: StickyAuthors) => void>();
    const host = Object.assign(new FakeHost(), { setStickyAuthors });
    const request = vi.fn<(_callback: () => void) => number>(() => 1);
    const view = hostView(host as unknown as EngineHost, { request, cancel: vi.fn() });
    const authors: StickyAuthors = {
      isShown: true,
      names: new Map([['user:ada', 'Ada']]),
      fallback: 'Former member',
    };

    view.setStickyAuthors(authors);
    expect(setStickyAuthors).toHaveBeenCalledExactlyOnceWith(authors);
    expect(request).not.toHaveBeenCalled();
    view.destroy();
    view.setStickyAuthors({ ...authors, isShown: false });
    expect(setStickyAuthors).toHaveBeenCalledTimes(1);
  });
});
