import { describe, expect, it } from 'vitest';

import { parseFont } from '@canvas/text';

import { createDefaultJobHandlers } from '../../workers/default-job-handlers.js';
import { resourceContext, type JobOutcome } from '../../workers/job-handlers.js';
import { loadRegularFontBytes } from '../__fixtures__/bundled-fonts.js';
import { glyphKeyOf } from '../atlas/glyph-key.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';

import { FakeMsdfgenModule } from './__fixtures__/fake-msdfgen-module.js';
import type { MsdfJobRequest } from './msdf-job-payload.js';
import { createMsdfJobHandler } from './msdf-job.js';

function request(overrides: Partial<MsdfJobRequest> = {}): MsdfJobRequest {
  return {
    faceId: '400|n|Liberation Sans',
    fontKey: '400|n|Liberation Sans#1',
    fontBytes: loadRegularFontBytes(),
    keys: [0x41, 0x20],
    tier: BASE_TIER,
    field: 'msdf',
    ...overrides,
  };
}

async function settle(outcome: JobOutcome<'msdf'> | Promise<JobOutcome<'msdf'>>) {
  return await outcome;
}

describe('createMsdfJobHandler', () => {
  it('generates MSDF glyphs with msdfgen, loading the module once', async () => {
    const module = new FakeMsdfgenModule();
    let loads = 0;
    const handler = createMsdfJobHandler({
      loadMsdfgen: () => {
        loads += 1;
        return Promise.resolve(module);
      },
    });
    const [first, second] = await Promise.all([
      settle(handler(request())),
      settle(handler(request())),
    ]);
    expect(loads).toBe(1);
    expect(first.response.glyphs.map(({ key, bitmap }) => [key, bitmap.field])).toEqual([
      [0x41, 'msdf'],
      [0x20, 'msdf'],
    ]);
    expect(second.response).toMatchObject({ faceId: '400|n|Liberation Sans', tier: BASE_TIER });
  });

  it('runs synchronously once msdfgen is loaded, so a main-thread drain can bound it', async () => {
    const handler = createMsdfJobHandler({
      loadMsdfgen: () => Promise.resolve(new FakeMsdfgenModule()),
    });
    await settle(handler(request()));
    expect(handler(request())).not.toBeInstanceOf(Promise);
  });

  it('loads each font into msdfgen once and frees the oldest past the cache size', async () => {
    const module = new FakeMsdfgenModule();
    const handler = createMsdfJobHandler({
      loadMsdfgen: () => Promise.resolve(module),
      maxCachedFonts: 1,
    });
    await settle(handler(request()));
    await settle(handler(request()));
    expect(module.loadedBytes).toHaveLength(1);
    await settle(handler(request({ fontKey: 'other#2' })));
    expect(module.loadedBytes).toHaveLength(2);
    expect(module.liveFonts).toBe(1);
  });

  it('transfers every bitmap buffer back', async () => {
    const handler = createMsdfJobHandler({
      loadMsdfgen: () => Promise.resolve(new FakeMsdfgenModule()),
    });
    const outcome = await settle(handler(request()));
    expect(outcome.transfer).toEqual(
      outcome.response.glyphs.map(({ bitmap }) => bitmap.pixels.buffer),
    );
  });

  it('falls back to single-channel fields without a loader', async () => {
    const outcome = await settle(createMsdfJobHandler()(request({ keys: [0x41] })));
    const [glyph] = outcome.response.glyphs;
    expect(glyph?.bitmap.field).toBe('sdf');
    expect(glyph?.bitmap.width).toBeGreaterThan(0);
  });

  it('falls back when msdfgen fails to load, and does not retry the load', async () => {
    let loads = 0;
    const handler = createMsdfJobHandler({
      loadMsdfgen: () => {
        loads += 1;
        return Promise.reject(new Error('no WebAssembly'));
      },
    });
    const first = await settle(handler(request()));
    const second = await settle(handler(request()));
    expect([first, second].map(({ response }) => response.glyphs[0]?.bitmap.field)).toEqual([
      'sdf',
      'sdf',
    ]);
    expect(loads).toBe(1);
  });

  it('falls back when msdfgen cannot read the font', async () => {
    const module = new FakeMsdfgenModule({ canLoad: false });
    const handler = createMsdfJobHandler({ loadMsdfgen: () => Promise.resolve(module) });
    const outcome = await settle(handler(request()));
    expect(outcome.response.glyphs[0]?.bitmap.field).toBe('sdf');
  });

  it('uses the fallback when the request asks for it', async () => {
    const module = new FakeMsdfgenModule();
    const handler = createMsdfJobHandler({ loadMsdfgen: () => Promise.resolve(module) });
    const outcome = await settle(handler(request({ field: 'sdf' })));
    expect(outcome.response.glyphs[0]?.bitmap.field).toBe('sdf');
    expect(module.generateCalls).toEqual([]);
  });

  it('generates a shaped key through the character its glyph is, as MSDF', async () => {
    const module = new FakeMsdfgenModule();
    const handler = createMsdfJobHandler({ loadMsdfgen: () => Promise.resolve(module) });
    const glyphId = parseFont(loadRegularFontBytes()).glyphIdOf(0x41);
    const shaped = glyphKeyOf({ codepoint: 0x41, glyphId });
    const outcome = await settle(handler(request({ keys: [shaped, 0x41] })));
    expect(outcome.response.glyphs.map(({ key, bitmap }) => [key, bitmap.field])).toEqual([
      [shaped, 'msdf'],
      [0x41, 'msdf'],
    ]);
    expect(module.generateCalls.map((call) => call.codepoint)).toEqual([0x41, 0x41]);
    expect(outcome.response.glyphs[0]?.bitmap).toEqual(outcome.response.glyphs[1]?.bitmap);
  });

  it('rasterizes a shaped key no character maps to, even with msdfgen loaded', async () => {
    const module = new FakeMsdfgenModule();
    const handler = createMsdfJobHandler({ loadMsdfgen: () => Promise.resolve(module) });
    const font = parseFont(loadRegularFontBytes());
    const mapped = new Set(font.characterMap().map(([, glyph]) => glyph));
    const unmapped = Array.from({ length: 4_000 }, (unused, id) => id).find(
      (id) => id > 0 && !mapped.has(id) && font.outlineOf(id).contours.length > 0,
    );
    if (unmapped === undefined) throw new Error('Liberation Sans has no unmapped outline');
    const shaped = glyphKeyOf({ codepoint: 0x41, glyphId: unmapped });
    const outcome = await settle(handler(request({ keys: [shaped] })));
    expect(outcome.response.glyphs[0]?.bitmap.field).toBe('sdf');
    expect(module.generateCalls).toEqual([]);
  });

  it('draws nothing for a character the font does not map', async () => {
    const outcome = await settle(createMsdfJobHandler()(request({ keys: [0x1f600] })));
    expect(outcome.response.glyphs[0]?.bitmap).toMatchObject({ width: 0, height: 0 });
  });

  it('is registered with the default job handlers, fallback only', async () => {
    const handler = createDefaultJobHandlers().msdf;
    const outcome = await settle(
      handler?.(request({ keys: [0x41] }), resourceContext(new Map())) ??
        Promise.reject(new Error('missing')),
    );
    expect(outcome.response.glyphs[0]?.bitmap.field).toBe('sdf');
  });
});
