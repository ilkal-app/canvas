import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isTestDeclaration } from './dist-files.ts';

describe("the SDK package's files", () => {
  it("knows a test's declarations from the API's", () => {
    expect(isTestDeclaration('mount/mount.test.d.ts')).toBe(true);
    expect(isTestDeclaration('api/sdk-api-version.test.d.ts.map')).toBe(true);
    expect(isTestDeclaration('mount/mount.d.ts')).toBe(false);
    expect(isTestDeclaration('mount/fonts-url.d.ts.map')).toBe(false);
  });

  it('leave out the fonts, the release scripts, the tests, any map and the build info', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { readonly files: readonly string[] };
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        'dist',
        '!dist/fonts',
        '!dist/scripts',
        '!dist/**/*.test.d.ts',
        '!dist/**/*.test.d.ts.map',
        '!dist/**/*.map',
        '!dist/**/*.tsbuildinfo',
      ]),
    );
  });
});
