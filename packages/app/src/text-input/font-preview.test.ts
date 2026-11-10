import { afterEach, expect, it, vi } from 'vitest';

const loader = vi.hoisted(() => ({
  ensure: vi.fn(),
  resolve: vi.fn(() => ({ bytes: new ArrayBuffer(8) })),
}));
vi.mock('./page-fonts.js', () => ({
  ensurePageFont: loader.ensure,
  pageFontLoader: () => ({ fonts: { resolve: loader.resolve } }),
}));

import { prepareFontPreview } from './font-preview.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('retries a failed preview when the family is requested again', async () => {
  const add = vi.fn();
  vi.stubGlobal('document', { fonts: { add } });
  vi.stubGlobal(
    'FontFace',
    class {
      load() {
        return Promise.resolve(this);
      }
    },
  );
  loader.ensure.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await prepareFontPreview('Preview retry');
  expect(add).not.toHaveBeenCalled();
  await prepareFontPreview('Preview retry');
  expect(add).toHaveBeenCalledOnce();
  expect(loader.ensure).toHaveBeenLastCalledWith('Preview retry', true);
  await prepareFontPreview('Preview retry');
  expect(add).toHaveBeenCalledOnce();
});
