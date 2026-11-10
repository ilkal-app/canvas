import { describe, expect, it, vi } from 'vitest';

import type { OverlayLabel } from '@canvas/tools';

import { OverlayLabelFeed } from './overlay-label-feed.js';

const SIZE: OverlayLabel = { kind: 'size', text: '176 × 130', at: { x: 604, y: 258 } };

describe('OverlayLabelFeed', () => {
  it('tells listeners only when the labels change, and keeps the same snapshot otherwise', () => {
    const feed = new OverlayLabelFeed();
    const listener = vi.fn();
    const stop = feed.subscribe(listener);
    const empty = feed.snapshot();
    feed.publish(undefined);
    feed.publish([]);
    expect(listener).not.toHaveBeenCalled();
    expect(feed.snapshot()).toBe(empty);
    feed.publish([SIZE]);
    expect(listener).toHaveBeenCalledTimes(1);
    const shown = feed.snapshot();
    feed.publish([{ ...SIZE, at: { ...SIZE.at } }]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(feed.snapshot()).toBe(shown);
    feed.publish([{ ...SIZE, text: '177 × 130' }]);
    expect(listener).toHaveBeenCalledTimes(2);
    feed.publish(undefined);
    expect(feed.snapshot()).toEqual([]);
    stop();
    feed.publish([SIZE]);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
