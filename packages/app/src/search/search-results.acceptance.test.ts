import { describe, expect, it } from 'vitest';

import type { SearchHit } from '@canvas/document';

import { groupSearchHits, nextActiveIndex } from './search-results.js';

const hit = (id: string, group: SearchHit['group']): SearchHit =>
  ({ id, group, text: id, pageId: 'page-1', sectionName: undefined }) as SearchHit;

describe('groupSearchHits', () => {
  it('uses the display group order and keeps each group’s input order', () => {
    const hits = [
      hit('section-a', 'sections'),
      hit('text-a', 'text'),
      hit('sticky-a', 'stickies'),
      hit('text-b', 'text'),
      hit('sticky-b', 'stickies'),
    ];

    expect(groupSearchHits(hits)).toEqual([
      { group: 'stickies', title: 'Stickies', hits: [hits[2], hits[4]] },
      { group: 'text', title: 'Text', hits: [hits[1], hits[3]] },
      { group: 'sections', title: 'Sections', hits: [hits[0]] },
    ]);
    expect(hits.map(({ id }) => id)).toEqual([
      'section-a',
      'text-a',
      'sticky-a',
      'text-b',
      'sticky-b',
    ]);
  });

  it('skips empty groups and leaves frozen input untouched', () => {
    const hits = Object.freeze([Object.freeze(hit('text-a', 'text'))]);
    expect(groupSearchHits(hits)).toEqual([{ group: 'text', title: 'Text', hits: [hits[0]] }]);
    expect(groupSearchHits([])).toEqual([]);
  });
});

describe('nextActiveIndex', () => {
  it('moves one result and clamps at both ends', () => {
    expect(nextActiveIndex(0, 1, 3)).toBe(1);
    expect(nextActiveIndex(2, -1, 3)).toBe(1);
    expect(nextActiveIndex(2, 1, 3)).toBe(2);
    expect(nextActiveIndex(0, -1, 3)).toBe(0);
  });

  it('returns -1 without results', () => {
    expect(nextActiveIndex(-1, 1, 0)).toBe(-1);
    expect(nextActiveIndex(0, -1, 0)).toBe(-1);
  });
});
