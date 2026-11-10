import { expect, it, vi } from 'vitest';

import { flushMicrotasks } from '../../workers/__fixtures__/fake-worker-transport.js';
import type { SubmitOptions } from '../../workers/job-submission.js';
import { loadRegularFontBytes } from '../__fixtures__/bundled-fonts.js';
import { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { BASE_TIER, HIGH_TIER } from '../atlas/glyph-tiers.js';
import { FontLibrary } from '../font/font-library.js';

import { GlyphSource, type MsdfJobSubmitter } from './glyph-source.js';
import type { MsdfJobRequest } from './msdf-job-payload.js';

it('submits two batches of one face with one resource and without copied font bytes', async () => {
  const fonts = new FontLibrary();
  const loaded = fonts.addFace(
    { family: 'Liberation Sans', weight: 400, isItalic: false },
    loadRegularFontBytes(),
  );
  let byteReads = 0;
  const guarded = new Proxy(loaded, {
    get(target, property) {
      if (property === 'bytes') byteReads += 1;
      return target[property as keyof typeof target];
    },
  });
  vi.spyOn(fonts, 'get').mockReturnValue(guarded);
  const submissions: { request: MsdfJobRequest; options: SubmitOptions }[] = [];
  const pool: MsdfJobSubmitter = {
    submit: (kind, request, options) => {
      expect(kind).toBe('msdf');
      submissions.push({ request, options });
      return { id: submissions.length, response: new Promise(() => undefined) };
    },
  };
  const source = new GlyphSource({ pool, fonts, atlas: new GlyphAtlas() });

  source.request({ faceId: loaded.faceId }, 0x41, BASE_TIER);
  source.request({ faceId: loaded.faceId }, 0x42, HIGH_TIER);
  await flushMicrotasks();

  expect(submissions).toHaveLength(2);
  expect(byteReads).toBe(0);
  expect(submissions.map(({ request }) => request.tier)).toEqual([BASE_TIER, HIGH_TIER]);
  for (const { request, options } of submissions) {
    expect(request.fontKey).toBe(loaded.fontKey);
    expect(request).not.toHaveProperty('fontBytes');
    expect(options).not.toHaveProperty('transfer');
    expect(options.resources).toHaveLength(1);
    expect(options.resources?.[0]).toBe(loaded.jobResource);
  }
  expect(submissions[0]?.options.resources?.[0]).toBe(submissions[1]?.options.resources?.[0]);
});
