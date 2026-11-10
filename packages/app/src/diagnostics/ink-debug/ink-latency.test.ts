import { describe, expect, it } from 'vitest';

import type { PointerInput } from '@canvas/engine';

import { InkLatencyTracker, isInkDebug } from './ink-latency.js';

/**
 * A pointer input at a time.
 *
 * @param type - Its type.
 * @param timestampMs - When, ms.
 * @param buttons - Its buttons; pressed if absent.
 * @returns The input.
 */
function input(type: PointerInput['type'], timestampMs: number, buttons = 1): PointerInput {
  return { type, xPx: 0, yPx: 0, buttons, pointerId: 1, timestampMs };
}

describe('InkLatencyTracker', () => {
  it('measures input to the page overlay’s paint, each stroke on its own', () => {
    const tracker = new InkLatencyTracker();
    tracker.overlayPaint(1, 100, 112);
    tracker.overlayPaint(1, 110, 130);
    expect(tracker.summary().painted).toEqual({ count: 2, p50Ms: 12, maxMs: 20 });
    tracker.overlayPaint(2, 200, 216);
    expect(tracker.summary().painted).toEqual({ count: 1, p50Ms: 16, maxMs: 16 });
  });

  it('times an overlay paint to the start of the next page frame after it, not its own', () => {
    const tracker = new InkLatencyTracker();
    tracker.overlayPaint(1, 100, 104);
    // The readout's own frame callback in the frame the overlay painted in: not after the paint.
    tracker.pageFrame(102);
    expect(tracker.summary().paintPresented.count).toBe(0);
    tracker.pageFrame(118);
    expect(tracker.summary().paintPresented).toEqual({ count: 1, p50Ms: 18, maxMs: 18 });
  });

  it('measures each pressed move to its frame and to the next page frame', () => {
    const tracker = new InkLatencyTracker();
    tracker.frame([input('down', 0), input('move', 10)], 40);
    tracker.pageFrame(48);
    tracker.frame([input('move', 26)], 50);
    tracker.frame([input('move', 0, 0)], 60);
    tracker.pageFrame(64);
    expect(tracker.summary()).toEqual({
      drawn: { count: 2, p50Ms: 24, maxMs: 30 },
      presented: { count: 2, p50Ms: 38, maxMs: 38 },
      painted: { count: 0, p50Ms: 0, maxMs: 0 },
      paintPresented: { count: 0, p50Ms: 0, maxMs: 0 },
    });
  });

  it('starts a new stroke at a press, and shows nothing before one', () => {
    const tracker = new InkLatencyTracker();
    expect(tracker.summary().drawn).toEqual({ count: 0, p50Ms: 0, maxMs: 0 });
    tracker.frame([input('down', 0), input('move', 10)], 50);
    tracker.frame([input('down', 100), input('move', 110)], 120);
    expect(tracker.summary().drawn).toEqual({ count: 1, p50Ms: 10, maxMs: 10 });
  });
});

describe('isInkDebug', () => {
  it('is on only for inkdebug=1', () => {
    expect(isInkDebug('?inkdebug=1')).toBe(true);
    expect(isInkDebug('?board=x&inkdebug=1')).toBe(true);
    expect(isInkDebug('?inkdebug=0')).toBe(false);
    expect(isInkDebug('')).toBe(false);
  });
});
