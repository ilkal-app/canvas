import { describe, expect, it } from 'vitest';

import { createBoard } from '../board/board.js';
import { BOARD_BOUND } from '../fields/board-bound.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';

import { deepFreeze } from './__fixtures__/deep-freeze.js';
import { detachCommentsFrom } from './detach-comments.js';

describe('detachCommentsFrom', () => {
  it('re-anchors a pin on a deleted object to a point where the pin was, in its parent frame', () => {
    const frame = sampleObject('frame', 'f', { x: 50, y: 50 });
    const target = sampleObject('shape', 't', { x: 200, y: 100 });
    const comment = sampleObject('comment', 'm', {
      parentId: frame.id,
      x: 0,
      y: 0,
      anchor: { kind: 'object', objectId: target.id, offset: { x: 5, y: 6 } },
    });
    const board = deepFreeze(createBoard([frame, target, comment]));
    const next = detachCommentsFrom(board, [target.id]);
    expect(next.objects.get(comment.id)).toEqual({
      ...comment,
      x: 155,
      y: 56,
      anchor: { kind: 'point' },
    });
    expect(board.objects.get(comment.id)).toBe(comment);
  });

  it('stores a detached pin as computed when the object it was on is past the bound', () => {
    const target = sampleObject('shape', 't', { x: 1e308, y: -1e308 });
    const comment = sampleObject('comment', 'm', {
      anchor: { kind: 'object', objectId: target.id, offset: { x: 5, y: 6 } },
    });
    const next = detachCommentsFrom(createBoard([target, comment]), [target.id]);
    const pin = next.objects.get(comment.id);
    expect(pin).toMatchObject({ x: 1e308 + 5, y: -1e308 + 6, anchor: { kind: 'point' } });
    expect(Math.abs(pin?.x ?? 0)).toBeGreaterThan(BOARD_BOUND);
  });

  it('leaves pins on surviving objects and point pins untouched', () => {
    const target = sampleObject('shape', 't');
    const onTarget = sampleObject('comment', 'on', {
      anchor: { kind: 'object', objectId: target.id, offset: { x: 0, y: 0 } },
    });
    const free = sampleObject('comment', 'free');
    const next = detachCommentsFrom(createBoard([target, onTarget, free]), [
      sampleObject('shape', 'other').id,
    ]);
    expect(next.objects.get(onTarget.id)).toBe(onTarget);
    expect(next.objects.get(free.id)).toBe(free);
  });
});
