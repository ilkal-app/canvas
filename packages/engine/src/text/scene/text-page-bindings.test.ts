import { describe, expect, it } from 'vitest';

import { FakeGpuBackend } from '../../scene/__fixtures__/fake-gpu-backend.js';
import { GlyphAtlas } from '../atlas/glyph-atlas.js';

import { FRAME_TITLE_PASS_KIND } from './frame-title-pass.js';
import { TextAtlasPages } from './text-atlas-pages.js';
import { TEXT_PASS_KIND, type TextPassKind } from './text-pass-definition.js';

describe('text pass page bindings', () => {
  it.each<[string, TextPassKind]>([
    ['scene text', TEXT_PASS_KIND],
    ['frame titles', FRAME_TITLE_PASS_KIND],
  ])('binds, for the %s, exactly what its pipeline declares', (name, kind) => {
    const pages = new TextAtlasPages(new FakeGpuBackend(), new GlyphAtlas(), kind.pagesPerGroup);
    pages.sync();
    const bound = pages.entriesOf(0).map((entry) => entry.binding);
    const declared = (kind.pipelineSpec.pageBindings ?? []).map((entry) => entry.binding);
    expect(bound).toEqual(declared);
    pages.destroy();
  });
});
