import { describe, expect, it } from 'vitest';

import { isPassPipelineLabel, pageVariantPipelineLabel } from './pass-pipeline-label.js';

describe('a pass pipeline label', () => {
  it('names a page-count variant after its pass and its slots', () => {
    expect(pageVariantPipelineLabel('scene-text', 4)).toBe('scene-text 4 pages');
  });

  it('counts the pass’s own pipeline and its page-count variants, nothing else', () => {
    expect(isPassPipelineLabel('scene-text', 'scene-text')).toBe(true);
    for (const slots of [1, 2, 4])
      expect(isPassPipelineLabel(pageVariantPipelineLabel('scene-text', slots), 'scene-text')).toBe(
        true,
      );
    expect(isPassPipelineLabel('scene-text move', 'scene-text')).toBe(false);
    expect(isPassPipelineLabel('scene-text-vector', 'scene-text')).toBe(false);
    expect(isPassPipelineLabel('scene-text pages', 'scene-text')).toBe(false);
    expect(isPassPipelineLabel('frame-title 2 pages', 'scene-text')).toBe(false);
  });
});
