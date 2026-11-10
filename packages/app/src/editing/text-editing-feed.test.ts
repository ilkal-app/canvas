import { describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { TextEditingFeed } from './text-editing-feed.js';

const SPOT = { objectId: 'note-1' as ObjectId, anchor: 1, focus: 3 };

describe('TextEditingFeed', () => {
  it('tells listeners only when the object or an offset changed', () => {
    const feed = new TextEditingFeed();
    const heard = vi.fn();
    const stop = feed.subscribe(heard);
    feed.publish(undefined);
    expect(heard).not.toHaveBeenCalled();
    feed.publish(SPOT);
    feed.publish({ ...SPOT });
    expect(feed.snapshot()).toBe(SPOT);
    feed.publish({ ...SPOT, focus: 4 });
    feed.publish({ ...SPOT, focus: 4, anchor: 0 });
    feed.publish({ ...SPOT, focus: 4, anchor: 0, objectId: 'note-2' as ObjectId });
    feed.publish(undefined);
    expect(heard).toHaveBeenCalledTimes(5);
    stop();
    feed.publish(SPOT);
    expect(heard).toHaveBeenCalledTimes(5);
  });
});
