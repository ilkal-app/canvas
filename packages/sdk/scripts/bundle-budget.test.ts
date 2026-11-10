import { describe, expect, it } from 'vitest';

import {
  allowedBytes,
  budgetOf,
  budgetProblems,
  budgetReport,
  lazyPartOf,
  measureBundle,
  type BundleFile,
} from './bundle-budget.ts';

/**
 * A file of the build.
 *
 * @param fileName - Its name in dist/.
 * @param contents - Its text.
 * @param imports - The chunks it imports statically.
 * @returns The file.
 */
function file(fileName: string, contents: string, imports: readonly string[] = []): BundleFile {
  return { fileName, contents, isEntry: fileName === 'index.js', imports };
}

/** A build: an entry importing a chunk and React, a lazy chunk, a worker, the wasm, a font, CSS. */
const BUILD: readonly BundleFile[] = [
  file('index.js', 'import "./index.css"; export * from "./index-a.js";', ['index-a.js', 'react']),
  file('index-a.js', 'x'.repeat(4000)),
  file('index-a.js.map', '{}'),
  file('msdf-job-b.js', 'y'.repeat(300)),
  file('assets/engine-worker-c.js', 'z'.repeat(900)),
  file('harfbuzz.wasm', 'w'.repeat(200)),
  file('assets/400-d.ttf', 'f'.repeat(100)),
  file('index.css', '.a{}'),
  file('index.d.ts', 'export {};'),
];

describe('the SDK bundle budget', () => {
  it('counts the entry and its static imports as the main script, and the rest by part', () => {
    const snapshot = JSON.stringify(BUILD);
    const measure = measureBundle(BUILD);
    expect(measure.main.files).toBe(2);
    expect(measure.main.bytes).toBe(String(BUILD[0]?.contents).length + 4000);
    expect(measure.main.gzipBytes).toBeGreaterThan(0);
    expect(measure.main.gzipBytes).toBeLessThan(measure.main.bytes);
    expect(measure.lazy.lazyChunks.files).toBe(1);
    expect(measure.lazy.workers.bytes).toBe(900);
    expect(measure.lazy.wasm.files).toBe(1);
    expect(measure.lazy.fonts.files).toBe(1);
    expect(measure.lazy.stylesheet.files).toBe(1);
    expect(measure.inlined).toEqual([]);
    expect(measure.unbudgeted).toEqual([]);
    expect(JSON.stringify(BUILD)).toBe(snapshot);
  });

  it('sorts files into parts, and leaves maps and declarations out', () => {
    expect(lazyPartOf('assets/job-worker-x.js')).toBe('workers');
    expect(lazyPartOf('assets/Geist-Medium-x.woff2')).toBe('fonts');
    expect(lazyPartOf('index-b.js')).toBe('lazyChunks');
    expect(lazyPartOf('index-b.js.map')).toBeUndefined();
    expect(lazyPartOf('index.d.ts')).toBeUndefined();
    expect(lazyPartOf('README.md')).toBeUndefined();
  });

  it('allows 1% of growth over a locked figure, rounded down', () => {
    expect(allowedBytes(100_000)).toBe(101_000);
    expect(allowedBytes(1_383_466)).toBe(1_397_300);
    expect(allowedBytes(99)).toBe(99);
  });

  it('passes a build within 1% of its figures, and fails a byte past that, naming the part', () => {
    const measure = measureBundle(BUILD);
    const budget = budgetOf(measure);
    expect(budgetProblems(measure, budget)).toEqual([]);
    // The smallest figure the main script still fits, and the one below it.
    let locked = measure.main.gzipBytes;
    while (allowedBytes(locked - 1) >= measure.main.gzipBytes) locked -= 1;
    expect(budgetProblems(measure, { ...budget, mainGzipBytes: locked })).toEqual([]);
    expect(budgetProblems(measure, { ...budget, mainGzipBytes: locked - 1 })).toEqual([
      `main script: ${String(measure.main.gzipBytes)} bytes gzipped, over its budget of ${String(locked - 1)} plus 1% (+${String(measure.main.gzipBytes - locked + 1)})`,
    ]);
    const fonts = budgetProblems(measure, {
      ...budget,
      lazyGzipBytes: { ...budget.lazyGzipBytes, fonts: Math.floor(budget.lazyGzipBytes.fonts / 2) },
    });
    expect(fonts).toHaveLength(1);
    expect(fonts[0]).toMatch(
      /^fonts: \d+ bytes gzipped, over its budget of \d+ plus 1% \(\+\d+\)$/u,
    );
  });

  it('measures two builds that differ only in content hashes the same', () => {
    const named = (hash: string) =>
      BUILD.map((part) =>
        part.fileName === 'index.js'
          ? { ...part, contents: `import "./index-${hash}.js"; import "./w-${hash}-${hash}.js";` }
          : part,
      );
    expect(measureBundle(named('Dz6U3U56')).main).toEqual(measureBundle(named('CurhGUXV')).main);
  });

  it('fails a font, the wasm or a script inlined into the main script, and a heavy part gone', () => {
    const inlined = BUILD.map((part) =>
      part.fileName === 'index-a.js'
        ? {
            ...part,
            contents: `const f = "data:font/ttf;base64,AAEA"; const g = "data:font/ttf;base64,AAEB"; const w = "data:application/wasm;base64,AGFz"; const e = "${'A'.repeat(70_000)}";`,
          }
        : part,
    ).filter(({ fileName }) => fileName !== 'assets/engine-worker-c.js');
    const measure = measureBundle(inlined);
    expect(measure.inlined).toEqual([
      'index-a.js: 2 data:font/ttf URL(s)',
      'index-a.js: 1 data:application/wasm URL(s)',
      'index-a.js: a base64 run of 70000 characters',
    ]);
    expect(budgetProblems(measure, budgetOf(measure))).toEqual([
      'inlined into the main script, not lazy: index-a.js: 2 data:font/ttf URL(s)',
      'inlined into the main script, not lazy: index-a.js: 1 data:application/wasm URL(s)',
      'inlined into the main script, not lazy: index-a.js: a base64 run of 70000 characters',
      'workers: no files of their own (inlined into the main script, or gone)',
    ]);
  });

  it('finds a long base64 run in one pass, however long the runs just under it', () => {
    const nearMisses = `${'A'.repeat(65_535)};`.repeat(80);
    const started = performance.now();
    const measure = measureBundle(
      BUILD.map((part) =>
        part.fileName === 'index-a.js'
          ? { ...part, contents: `${nearMisses}"${'B'.repeat(65_536)}"` }
          : part,
      ),
    );
    expect(measure.inlined).toEqual(['index-a.js: a base64 run of 65536 characters']);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('fails an emitted file no part counts', () => {
    const measure = measureBundle([...BUILD, file('assets/logo.png', 'png')]);
    expect(measure.unbudgeted).toEqual(['assets/logo.png']);
    expect(budgetProblems(measure, budgetOf(measure))).toEqual([
      'counted by no part of the budget: assets/logo.png',
    ]);
  });

  it('reports every part beside its budget, and refuses a build with no entry', () => {
    const measure = measureBundle(BUILD);
    const report = budgetReport(measure, budgetOf(measure));
    expect(report).toHaveLength(6);
    expect(report[0]).toMatch(/^ {2}main script +2 files/u);
    expect(() => measureBundle(BUILD.slice(1))).toThrow('The build has no entry.');
  });
});
