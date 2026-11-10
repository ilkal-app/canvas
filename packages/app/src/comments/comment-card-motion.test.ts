// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { CARD_CLOSE_MS, useCardMotion } from './comment-card-motion.js';
import type { CommentData } from './comment-data-context.js';

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Comments with a thread open, a placement being written, or nothing open.
 *
 * @param open - The open thread's id, or a placement's pin id prefixed `new:`.
 * @returns The comments, as far as the hook reads them.
 */
function comments(open?: string): CommentData {
  const placement = open?.startsWith('new:')
    ? { id: open.slice(4) as ObjectId, point: { x: 0, y: 0 }, anchor: { kind: 'point' as const } }
    : undefined;
  return {
    selectedId: placement || open === undefined ? undefined : open,
    placement,
  } as CommentData;
}

describe('useCardMotion', () => {
  it('opens a card, then keeps it drawn for its close animation, inert, for 120 ms', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ data }) => useCardMotion(data, () => false), {
      initialProps: { data: comments('a') },
    });
    expect(result.current).toMatchObject({ key: 'a', isClosing: false, isSwitch: false });
    rerender({ data: comments() });
    expect(result.current).toMatchObject({ key: 'a', isClosing: true });
    expect(result.current.content?.selectedId).toBe('a');
    act(() => {
      vi.advanceTimersByTime(CARD_CLOSE_MS);
    });
    expect(result.current).toMatchObject({ key: undefined, content: undefined });
  });

  it('never commits a frame without the card between open and closing', () => {
    vi.useFakeTimers();
    const commits: (string | undefined)[] = [];
    const { rerender } = renderHook(
      ({ data }) => {
        const motion = useCardMotion(data, () => false);
        useLayoutEffect(() => {
          commits.push(motion.isClosing ? `closing ${String(motion.key)}` : motion.key);
        });
        return motion;
      },
      { initialProps: { data: comments('a') } },
    );
    rerender({ data: comments() });
    act(() => {
      vi.advanceTimersByTime(CARD_CLOSE_MS);
    });
    expect(commits).toEqual(['a', 'closing a', undefined]);
  });

  it('closes at once with reduced motion', () => {
    const { result, rerender } = renderHook(({ data }) => useCardMotion(data, () => true), {
      initialProps: { data: comments('a') },
    });
    rerender({ data: comments() });
    expect(result.current.content).toBeUndefined();
  });

  it('says a card replaced another (it cross-fades), and keeps saying so for that card', () => {
    const { result, rerender } = renderHook(({ data }) => useCardMotion(data, () => false), {
      initialProps: { data: comments('a') },
    });
    rerender({ data: comments('b') });
    expect(result.current).toMatchObject({ key: 'b', isSwitch: true });
    rerender({ data: comments('b') });
    expect(result.current.isSwitch).toBe(true);
  });

  it('grows a card opened after the last one closed, and one for a new comment', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ data }) => useCardMotion(data, () => false), {
      initialProps: { data: comments('a') },
    });
    rerender({ data: comments() });
    rerender({ data: comments('b') });
    expect(result.current).toMatchObject({ key: 'b', isClosing: false, isSwitch: false });
    rerender({ data: comments() });
    act(() => {
      vi.advanceTimersByTime(CARD_CLOSE_MS);
    });
    rerender({ data: comments('new:pin') });
    expect(result.current).toMatchObject({ key: 'pin', isSwitch: false });
    expect(result.current.content?.placement?.id).toBe('pin');
  });
});
