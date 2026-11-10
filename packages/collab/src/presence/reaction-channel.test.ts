import { describe, expect, it, vi } from 'vitest';

import type { ReactionDrop } from '@canvas/schema';

import { ReactionChannel } from './reaction-channel.js';

const DROP: ReactionDrop = { emoji: '🙌', x: 1, y: 2, pageId: 'page-1' };

describe('ReactionChannel', () => {
  it('sends on the attached connection only while it can, and on the newest one', () => {
    const channel = new ReactionChannel();
    expect(channel.send(DROP)).toBe(false);
    const first = vi.fn(() => true);
    channel.attach(first);
    expect(channel.send(DROP)).toBe(true);
    expect(first).toHaveBeenCalledWith(JSON.stringify({ type: 'reaction', ...DROP }));
    const second = vi.fn(() => false);
    channel.attach(second);
    expect(channel.send(DROP)).toBe(false);
    expect(first).toHaveBeenCalledOnce();
    expect(() => channel.send({ ...DROP, x: Number.NaN })).toThrow(RangeError);
  });

  it('hands others’ reactions to every listener, a throwing one not stopping the rest', () => {
    const channel = new ReactionChannel();
    const failure = new Error('listener failed');
    const healthy = vi.fn();
    channel.subscribe(() => {
      throw failure;
    });
    const stop = channel.subscribe(healthy);
    const event = { ...DROP, from: 'ada' };
    expect(() => {
      channel.receive(event);
    }).toThrow(failure);
    expect(healthy).toHaveBeenCalledWith(event);
    stop();
    expect(() => {
      channel.receive(event);
    }).toThrow(failure);
    expect(healthy).toHaveBeenCalledOnce();
  });
});
