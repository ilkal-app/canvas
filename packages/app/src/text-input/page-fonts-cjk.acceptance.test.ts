/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, it, vi } from 'vitest';

import { cjkSlices, createSubsetter, parseFont } from '@canvas/text';

import { DEFAULT_TEXT_STYLE } from './font-catalogue.js';
// The page-fonts module's whole graph (the engine's root behind it) is transformed while the file
// is collected, which no hook or test timeout counts: a cold transform took over 30 s on a
// loaded queue shard. Each test's fresh import then only re-evaluates it (about 0.2 s).
import './page-fonts.js';

afterEach(() => vi.unstubAllGlobals());

it('holds Chinese page layout only for base and han-0, then lays out without other SC slices', async () => {
  const wasm = readFileSync(
    createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'),
  );
  const subsetter = await createSubsetter(wasm);
  const files = new Map<string, Uint8Array>();
  // Regular text needs the regular slices only (a need's weights).
  for (const weight of [400] as const) {
    const source = readFileSync(
      new URL(
        `../../assets/fonts/script-coverage/notosanssc/${String(weight)}.ttf`,
        import.meta.url,
      ),
    );
    const groups = cjkSlices(
      'Noto Sans SC',
      parseFont(source)
        .characterMap()
        .map(([point]) => point),
    );
    for (const id of ['base', 'han-0']) {
      const points = groups.get(id);
      if (points === undefined) throw new Error(`Source lacks ${id}`);
      files.set(`${String(weight)}-${id}.ttf`, subsetter.subset(source, points));
    }
  }
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/cjk/sc/')) {
      requested.push(url);
      const match = /\/(400|700)-(base|han-0)\.ttf(?:\?|$)/u.exec(url);
      const file = match === null ? undefined : `${match[1] ?? ''}-${match[2] ?? ''}.ttf`;
      const bytes = file === undefined ? undefined : files.get(file);
      if (bytes === undefined) return new Response(null, { status: 404 });
      if (file === '400-han-0.ttf') await gate;
      return new Response(Uint8Array.from(bytes).buffer);
    }
    return new Response(readFileSync(fileURLToPath(url)));
  });
  vi.resetModules();
  const { PAGE_TEXT_LAYOUT, loadPageFonts } = await import('./page-fonts.js');
  await loadPageFonts().loaded;
  const sample = '中文';
  const input = {
    text: sample,
    runs: [{ length: sample.length, style: DEFAULT_TEXT_STYLE }],
    wrapWidth: null,
    align: 'left',
  } as const;
  expect(PAGE_TEXT_LAYOUT.layout(input)).toBeUndefined();
  await vi.waitFor(
    () => {
      expect(requested).toHaveLength(2);
    },
    { timeout: 5_000 },
  );
  expect(
    requested.map((url) => /\/(400|700)-(base|han-\d+)\.ttf/u.exec(url)?.[0].slice(1)).sort(),
  ).toEqual([...files.keys()].sort());
  expect(PAGE_TEXT_LAYOUT.layout(input)).toBeUndefined();
  release();
  await vi.waitFor(
    () => {
      expect(PAGE_TEXT_LAYOUT.layout(input)?.lines).toHaveLength(1);
    },
    {
      timeout: 10_000,
    },
  );
  expect(requested).toHaveLength(2);
}, 60_000);
