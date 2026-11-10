/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { expect, it, vi } from 'vitest';

import { FontLibrary } from '@canvas/engine';
import { cjkSlices, createSubsetter, parseFont } from '@canvas/text';

import { DemandFonts } from './demand-fonts.js';
import type { FontFamilyEntry } from './font-catalogue.js';

it('fetches only requested SC slices at both weights and publishes their readiness', async () => {
  const family = 'Noto Sans SC';
  const ids = ['base', 'han-0'] as const;
  const wasm = readFileSync(
    createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'),
  );
  const subsetter = await createSubsetter(wasm);
  const files = new Map<string, ArrayBuffer>();
  const faces = ([400, 700] as const).flatMap((weight) => {
    const source = readFileSync(
      new URL(
        `../../assets/fonts/script-coverage/notosanssc/${String(weight)}.ttf`,
        import.meta.url,
      ),
    );
    const groups = cjkSlices(
      family,
      parseFont(source)
        .characterMap()
        .map(([point]) => point),
    );
    return ids.map((id) => {
      const url = new URL(
        `../../assets/fonts/cjk-slices/notosanssc/${String(weight)}-${id}.ttf?no-inline`,
        import.meta.url,
      ).href;
      const points = groups.get(id);
      if (points === undefined) throw new Error(`Source has no ${id} slice`);
      files.set(url, Uint8Array.from(subsetter.subset(source, points)).buffer);
      return { family, weight, isItalic: false, postScriptName: `cjk-slice:${id}`, url };
    });
  });
  const entry: FontFamilyEntry = { family, category: 'sans', faces };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchBytes = vi.fn(async (url: string) => {
    await gate;
    const bytes = files.get(url);
    if (bytes === undefined) throw new Error(`Unexpected fetch: ${url}`);
    return bytes;
  });
  const demand = new DemandFonts(new FontLibrary(), [entry], fetchBytes) as DemandFonts & {
    ensureSlices(family: string, ids: readonly string[]): Promise<boolean>;
    sliceStatus(family: string, ids: readonly string[]): 'idle' | 'loading' | 'ready' | 'failed';
  };
  expect(demand.sliceStatus(family, ids)).toBe('idle');
  const loading = demand.ensureSlices(family, ids);
  expect(demand.sliceStatus(family, ids)).toBe('loading');
  expect(fetchBytes.mock.calls.map(([url]) => url).sort()).toEqual([...files.keys()].sort());
  release();
  expect(await loading).toBe(true);
  expect(demand.sliceStatus(family, ids)).toBe('ready');
  expect(await demand.ensureSlices(family, ids)).toBe(true);
  expect(fetchBytes).toHaveBeenCalledTimes(4);
}, 60_000);
