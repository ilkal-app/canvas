import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  defaultFontsUrl,
  FONT_FILE_SCHEME,
  fontFilePath,
  fontNamesIn,
  fontUrlsIn,
  licenceFilesOf,
  missingFontFiles,
} from './font-files.ts';

/** The repository's root. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe("the SDK's font files", () => {
  it('load by default from jsDelivr, at the SDK version, from the fonts package', () => {
    expect(defaultFontsUrl('@ilkal/fonts', '0.1.3')).toBe(
      'https://cdn.jsdelivr.net/npm/@ilkal/fonts@0.1.3/',
    );
  });

  it("are named by their path in the fonts package: a package's assets/fonts, or npm's", () => {
    expect(fontFilePath('/repo/packages/app/assets/fonts/library/opensans/400.ttf')).toBe(
      'app/library/opensans/400.ttf',
    );
    expect(fontFilePath('/repo/packages/engine/assets/fonts/LiberationSans-Regular.ttf')).toBe(
      'engine/LiberationSans-Regular.ttf',
    );
    expect(
      fontFilePath(
        '/repo/node_modules/.pnpm/@expo-google-fonts+lora@0.4.2/node_modules/@expo-google-fonts/lora/400Regular/Lora_400Regular.ttf',
      ),
    ).toBe('npm/@expo-google-fonts/lora/400Regular/Lora_400Regular.ttf');
    expect(() => fontFilePath('/repo/packages/app/src/odd.ttf')).toThrow(
      "outside a package's assets/fonts/ and node_modules/",
    );
  });

  it("find a module's font URLs as it writes them: quoted, on lines, with a query", () => {
    const code = [
      "const a = new URL('../../assets/fonts/a/400.ttf?no-inline', import.meta.url).href;",
      'const b = new URL(\n  "../../assets/fonts/b/700i.ttf",\n  import.meta.url,\n);',
      "const w = new URL('./harfbuzz.wasm', import.meta.url);",
      "const s = new URL('./worker.js', import.meta.url);",
      "const g = new URL('../../assets/fonts/Geist-Regular.woff2?no-inline', import.meta.url);",
    ].join('\n');
    const found = fontUrlsIn(code);
    expect(found.map(({ relativePath }) => relativePath)).toEqual([
      '../../assets/fonts/a/400.ttf',
      '../../assets/fonts/b/700i.ttf',
      '../../assets/fonts/Geist-Regular.woff2',
    ]);
    for (const { start, end } of found) {
      expect(code.slice(start, end)).toMatch(/^new URL\([\s\S]*import\.meta\.url,?\s*\)$/u);
    }
  });

  it('read the names a built script holds, each once, and those with no file', () => {
    const code = `a("${FONT_FILE_SCHEME}app/x/400.ttf");b('${FONT_FILE_SCHEME}app/x/400.ttf');c(\`${FONT_FILE_SCHEME}engine/L.ttf\`)`;
    expect(fontNamesIn(code)).toEqual(['app/x/400.ttf', 'engine/L.ttf']);
    expect(missingFontFiles([code], new Set(['fonts/app/x/400.ttf']))).toEqual(['engine/L.ttf']);
    expect(
      missingFontFiles([code, ''], new Set(['fonts/app/x/400.ttf', 'fonts/engine/L.ttf'])),
    ).toEqual([]);
  });

  it('carry the licence files beside them, or the npm package root', () => {
    const library = join(ROOT, 'packages/app/assets/fonts/library/opensans/400.ttf');
    expect(licenceFilesOf(library)).toEqual([
      join(ROOT, 'packages/app/assets/fonts/library/opensans/LICENSE.txt'),
    ]);
    const engine = join(ROOT, 'packages/engine/assets/fonts/LiberationSans-Regular.ttf');
    expect(licenceFilesOf(engine)).toEqual([join(ROOT, 'packages/engine/assets/fonts/LICENSE')]);
  });
});
