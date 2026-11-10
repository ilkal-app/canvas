import { describe, expect, it } from 'vitest';

import { createBoard } from '../board/board.js';
import type { ObjectId } from '../ids/object-id.js';
import type { PageId } from '../ids/page-id.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import { MAX_PAGES, type Page } from '../pages/page.js';

import { validateBoard } from './validate-board.js';

const page = (id: string, order = 'a0'): Page => ({ id: id as PageId, name: id, order });
const pageId = (value: string): PageId => value as PageId;

describe('validateBoard page rules', () => {
  it('accepts objects on live pages, children naming none, and the default page by fallback', () => {
    const frame = sampleObject('frame', 'frame', { pageId: pageId('p2') });
    const child = sampleObject('shape', 'child', { parentId: frame.id, pageId: null });
    const legacy = sampleObject('shape', 'legacy');
    const board = createBoard([frame, child, legacy], [page('page-1'), page('p2', 'a1')]);
    expect(validateBoard(board)).toEqual([]);
    expect(validateBoard(createBoard([legacy]))).toEqual([]);
  });

  it('reports a root object on a page the board lacks and a child naming a page', () => {
    const frame = sampleObject('frame', 'frame');
    const board = createBoard([
      frame,
      sampleObject('shape', 'lost', { pageId: pageId('gone') }),
      sampleObject('shape', 'named', { parentId: frame.id, pageId: pageId('page-1') }),
    ]);
    expect(validateBoard(board).map(({ code, objectId }) => [code, objectId])).toEqual([
      ['missing-page', 'lost'],
      ['invalid-page', 'named'],
    ]);
  });

  it('reports a connector end and a comment anchor on another page', () => {
    const here = sampleObject('shape', 'here', { pageId: pageId('page-1') });
    const there = sampleObject('shape', 'there', { pageId: pageId('p2') });
    const connector = sampleObject('connector', 'conn', {
      pageId: pageId('page-1'),
      from: { kind: 'object', objectId: here.id, anchor: null },
      to: { kind: 'object', objectId: there.id, anchor: null },
    });
    const comment = sampleObject('comment', 'pin', {
      pageId: pageId('page-1'),
      anchor: { kind: 'object', objectId: 'there' as ObjectId, offset: { x: 0, y: 0 } },
    });
    const board = createBoard(
      [here, there, connector, comment],
      [page('page-1'), page('p2', 'a1')],
    );
    expect(validateBoard(board).map(({ code, objectId, path }) => [code, objectId, path])).toEqual([
      ['cross-page', 'conn', ['to', 'objectId']],
      ['cross-page', 'pin', ['anchor', 'objectId']],
    ]);
  });

  it('counts an object on a page that is not live on the first page, as the repair will', () => {
    const here = sampleObject('shape', 'here', { pageId: pageId('page-1') });
    const stranded = sampleObject('connector', 'conn', {
      pageId: pageId('gone'),
      from: { kind: 'object', objectId: here.id, anchor: null },
      to: { kind: 'point', x: 0, y: 0 },
    });
    const board = createBoard([here, stranded], [page('page-1')]);
    expect(validateBoard(board).map(({ code }) => code)).toEqual(['missing-page']);
  });

  it('reports more than MAX_PAGES live pages as a notice only', () => {
    const pages = Array.from({ length: MAX_PAGES + 1 }, (unused, index) =>
      page(`p${String(index)}`),
    );
    const board = createBoard([sampleObject('shape', 's', { pageId: pageId('p0') })], pages);
    expect(validateBoard(board)).toEqual([
      expect.objectContaining({ code: 'page-count', severity: 'notice', objectId: null }),
    ]);
    expect(validateBoard(createBoard([], pages.slice(0, MAX_PAGES)))).toEqual([]);
  });
});
