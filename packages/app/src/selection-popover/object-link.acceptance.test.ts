// Item 2, written before the code. CONTRACT: object links preserve board query and discard share fragments. Deliberately not asserted: query serialization order or URL escaping style.
import { describe, expect, it } from 'vitest';

import { OBJECT_PARAMETER, objectLinkOf } from '../index.js';

describe('object link', () => {
  it('sets the object, keeps the page and other board parameters, and drops the share secret', () => {
    const link = new URL(
      objectLinkOf('https://canvas.example/board/123?page=second&mode=review#secret', 'shape-1'),
    );
    expect(OBJECT_PARAMETER).toBe('object');
    expect(link.pathname).toBe('/board/123');
    expect(link.searchParams.get('page')).toBe('second');
    expect(link.searchParams.get('mode')).toBe('review');
    expect(link.searchParams.get(OBJECT_PARAMETER)).toBe('shape-1');
    expect(link.hash).toBe('');
  });

  it('replaces a prior object without mutating other parameters', () => {
    const link = new URL(
      objectLinkOf('https://canvas.example/board/123?object=old&page=one#key', 'new id'),
    );
    expect(link.searchParams.getAll('object')).toEqual(['new id']);
    expect(link.searchParams.get('page')).toBe('one');
    expect(link.hash).toBe('');
  });
});
