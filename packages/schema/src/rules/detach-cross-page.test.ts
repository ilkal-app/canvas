import { describe, expect, it } from 'vitest';

import { createBoard } from '../board/board.js';
import type { ObjectId } from '../ids/object-id.js';
import type { PageId } from '../ids/page-id.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import type { BoardObject } from '../objects/board-object.js';

import { detachAcrossPages } from './detach-cross-page.js';

const pageOf = (object: BoardObject): PageId | undefined => object.pageId ?? undefined;

describe('detachAcrossPages (R4)', () => {
  const here = sampleObject('shape', 'here', { pageId: 'a' as PageId, x: 0, y: 0 });
  const there = sampleObject('shape', 'there', { pageId: 'b' as PageId, x: 500, y: 0 });
  const connector = sampleObject('connector', 'conn', {
    pageId: 'a' as PageId,
    x: 0,
    y: 0,
    from: { kind: 'object', objectId: here.id, anchor: { x: 1, y: 0.5 } },
    to: { kind: 'object', objectId: there.id, anchor: { x: 0, y: 0.5 } },
  });
  const pin = sampleObject('comment', 'pin', {
    pageId: 'a' as PageId,
    anchor: { kind: 'object', objectId: 'there' as ObjectId, offset: { x: 5, y: 5 } },
  });
  const board = createBoard([here, there, connector, pin]);

  it('frees the end on another page where it was and keeps the end on its page', () => {
    const [detached] = detachAcrossPages(board, [connector.id], pageOf);
    expect(detached).toMatchObject({
      from: { kind: 'object', objectId: 'here' },
      to: { kind: 'point', x: 500 },
    });
  });

  it('turns a pin on another page into a point pin where it was', () => {
    const [detached] = detachAcrossPages(board, [pin.id], pageOf);
    expect(detached).toMatchObject({ anchor: { kind: 'point' }, x: 505, y: 5 });
  });

  it('changes nothing on one page, for unknown pages, or for other objects', () => {
    expect(detachAcrossPages(board, [here.id, 'missing' as ObjectId], pageOf)).toEqual([]);
    expect(detachAcrossPages(board, [connector.id], () => 'a' as PageId)).toEqual([]);
    expect(detachAcrossPages(board, [connector.id, pin.id], () => undefined)).toEqual([]);
  });
});
