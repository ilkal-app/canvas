import { describe, expect, it } from 'vitest';

import { LINK_LABEL_MAX_LENGTH, linkLabelOf } from './link-label.js';

describe('linkLabelOf', () => {
  it.each([
    ['https://example.com/', 'example.com'],
    ['https://example.com/roadmap', 'example.com/roadmap'],
    ['http://example.com/a/?q=1#top', 'example.com/a/?q=1#top'],
    ['mailto:ada@example.com', 'ada@example.com'],
  ])('labels %j as %j', (link, label) => {
    expect(linkLabelOf(link)).toBe(label);
  });

  it('cuts a long address with an ellipsis', () => {
    const label = linkLabelOf(`https://example.com/${'a'.repeat(100)}`);
    expect(label).toHaveLength(LINK_LABEL_MAX_LENGTH);
    expect(label.endsWith('…')).toBe(true);
  });
});
