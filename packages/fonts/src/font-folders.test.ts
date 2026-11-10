import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FONT_FOLDERS, unknownFolders } from './font-folders.js';

describe("the fonts package's folders", () => {
  it('lists every folder in package.json, so npm packs each', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { readonly files: readonly string[] };
    expect(manifest.files).toEqual(expect.arrayContaining([...FONT_FOLDERS]));
  });

  it("names a folder of the SDK's fonts it has no place for", () => {
    expect(
      unknownFolders([
        'app/library/opensans/400.ttf',
        'engine/LiberationSans-Regular.ttf',
        'npm/@expo-google-fonts/lora/400Regular/Lora_400Regular.ttf',
      ]),
    ).toEqual([]);
    expect(unknownFolders(['tools/x.ttf', 'app/a.ttf', 'tools/y.ttf', 'text/z.ttf'])).toEqual([
      'text',
      'tools',
    ]);
  });
});
