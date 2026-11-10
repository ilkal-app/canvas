import { describe, expect, it } from 'vitest';

import { DEFAULT_FONTS_URL, FONT_FILE_SCHEME, fontFileUrl, fontsFolder } from './fonts-url.js';

const SCHEME = 'canvas-sdk-font:';

describe('the fonts folder', () => {
  it('takes an absolute fontsUrl as it is, as a folder', () => {
    expect(fontsFolder('https://cdn.example/fonts/', 'https://host.example/app/')).toBe(
      'https://cdn.example/fonts/',
    );
    expect(fontsFolder('https://cdn.example/fonts', 'https://host.example/app/')).toBe(
      'https://cdn.example/fonts/',
    );
  });

  it("resolves a relative fontsUrl against the page's address", () => {
    expect(fontsFolder('/fonts/', 'https://host.example/app/board')).toBe(
      'https://host.example/fonts/',
    );
    expect(fontsFolder('static/fonts', 'https://host.example/app/board')).toBe(
      'https://host.example/app/static/fonts/',
    );
  });

  it('refuses what is not a URL', () => {
    expect(() => fontsFolder('https://', 'about:blank')).toThrow(TypeError);
  });
});

describe('a font file URL', () => {
  it("resolves the build's name of a file against the fonts folder", () => {
    expect(
      fontFileUrl(
        `${SCHEME}app/library/opensans/400.ttf`,
        SCHEME,
        'https://cdn.jsdelivr.net/npm/@ilkal/fonts@0.1.1/',
      ),
    ).toBe('https://cdn.jsdelivr.net/npm/@ilkal/fonts@0.1.1/app/library/opensans/400.ttf');
  });

  it('leaves any other URL as it is', () => {
    expect(
      fontFileUrl('https://host.example/own.woff2', SCHEME, 'https://cdn.example/fonts/'),
    ).toBe('https://host.example/own.woff2');
  });

  it('has no default where the SDK runs unbuilt: its fonts are named where they are served', () => {
    expect(DEFAULT_FONTS_URL).toBeUndefined();
    expect(FONT_FILE_SCHEME).toBeUndefined();
  });
});
