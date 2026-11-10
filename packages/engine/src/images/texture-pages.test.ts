import { describe, expect, it } from 'vitest';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';

import {
  IMAGE_SAMPLER_BINDING,
  IMAGE_TEXTURE_BINDING,
  PLACEHOLDER_PAGE,
  TexturePages,
} from './texture-pages.js';

function texture(backend: FakeGpuBackend, label: string) {
  return backend.createTexture({ format: 'rgba8unorm', width: 4, height: 4, label });
}

describe('TexturePages', () => {
  it('starts with a white placeholder texel on page 0', () => {
    const backend = new FakeGpuBackend();
    const pages = new TexturePages(backend);

    expect(pages.size).toBe(1);
    expect(pages.textureOf(PLACEHOLDER_PAGE)).toMatchObject({ width: 1, height: 1 });
    expect(backend.count('writeTexture')).toBe(1);
  });

  it('numbers pages from 1 and reuses a removed page number', () => {
    const backend = new FakeGpuBackend();
    const pages = new TexturePages(backend);
    const first = pages.add(texture(backend, 'a'));
    const second = pages.add(texture(backend, 'b'));

    pages.remove(first);

    expect([first, second]).toEqual([1, 2]);
    expect(pages.add(texture(backend, 'c'))).toBe(1);
    expect(backend.liveTextures().map(({ label }) => label)).toEqual([
      'image placeholder',
      'b',
      'c',
    ]);
  });

  it('binds a page texture and the shared sampler, the same entries each time', () => {
    const backend = new FakeGpuBackend();
    const pages = new TexturePages(backend);
    const page = pages.add(texture(backend, 'a'));

    const entries = pages.entriesOf(page);

    expect(entries.map(({ binding }) => binding)).toEqual([
      IMAGE_TEXTURE_BINDING,
      IMAGE_SAMPLER_BINDING,
    ]);
    expect(pages.entriesOf(page)).toBe(entries);
  });

  it('binds the placeholder for a page that is gone', () => {
    const backend = new FakeGpuBackend();
    const pages = new TexturePages(backend);
    const page = pages.add(texture(backend, 'a'));
    pages.remove(page);

    expect(pages.entriesOf(page)).toBe(pages.entriesOf(PLACEHOLDER_PAGE));
  });

  it('refuses to remove the placeholder', () => {
    const pages = new TexturePages(new FakeGpuBackend());

    expect(() => {
      pages.remove(PLACEHOLDER_PAGE);
    }).toThrow(RangeError);
  });
});
