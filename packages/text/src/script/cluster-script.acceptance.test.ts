import { describe, expect, it } from 'vitest';

import { clusterScript, scriptExtensionsOf } from '@canvas/text';

describe('clusterScript', () => {
  it('uses the first non-Common, non-Inherited codepoint in the cluster', () => {
    expect(clusterScript('(\u0e01)', 0, 2)).toBe('Thai');
    expect(clusterScript('A\u0301', 0, 2, 'Thai')).toBe('Latn');
    expect(clusterScript('\u{1f469}\u200d\u{1f467}', 0, 5)).toBe('Zyyy');
  });

  it('carries the previous script through Common and Inherited clusters', () => {
    expect(clusterScript('123', 0, 3, 'Thai')).toBe('Thai');
    expect(clusterScript('\u0301', 0, 1, 'Latn')).toBe('Latn');
    expect(clusterScript('123', 0, 3)).toBe('Zyyy');
  });

  it('uses a matching first-codepoint Script_Extensions value before carrying previous', () => {
    // U+30FC has Hira/Kana Script_Extensions, while its Script is Common.
    expect(scriptExtensionsOf(0x30fc)).toContain('Hira');
    expect(clusterScript('\u30fc', 0, 1, 'Hira')).toBe('Hira');
    expect(clusterScript('\u30fc', 0, 1, 'Thai')).toBe('Thai');
  });

  it('interprets start and end as UTF-16 indices', () => {
    const text = '\u{1f1ef}\u{1f1f5}\u0e01';
    expect(clusterScript(text, 4, 5, 'Latn')).toBe('Thai');
  });
});
