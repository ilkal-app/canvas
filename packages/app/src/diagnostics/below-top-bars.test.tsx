// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { useRef, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BELOW_TOP_BARS_GAP_PX, belowTopBars, useBelowTopBars } from './below-top-bars.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('belowTopBars', () => {
  it('starts below the bars by the gap and fits the rest of the container', () => {
    expect(belowTopBars({ bottom: 158 }, { top: 100, height: 600 }, 12)).toEqual({
      topPx: 58 + BELOW_TOP_BARS_GAP_PX,
      maxHeightPx: 600 - 66 - 12,
    });
  });

  it('follows taller bars, and never goes negative', () => {
    expect(belowTopBars({ bottom: 220 }, { top: 100, height: 600 }, 12).topPx).toBe(128);
    expect(belowTopBars({ bottom: 50 }, { top: 100, height: 10 }, 12)).toEqual({
      topPx: BELOW_TOP_BARS_GAP_PX,
      maxHeightPx: 0,
    });
  });
});

/**
 * An overlay in a positioned container beside top bars, as the shell lays them out.
 *
 * @returns The page.
 */
function Shell(): ReactElement {
  const ref = useRef<HTMLElement>(null);
  useBelowTopBars(ref, 12);
  return (
    <div data-testid="container">
      <div data-top-bars="" />
      <section ref={ref} data-testid="overlay" />
    </div>
  );
}

describe('useBelowTopBars', () => {
  it('places the element below the bars as measured', () => {
    const rects: Record<string, Partial<DOMRect>> = {
      container: { top: 0, height: 800 },
      bars: { bottom: 90 },
    };
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.parentElement;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const key = this.hasAttribute('data-top-bars') ? 'bars' : 'container';
      return rects[key] as DOMRect;
    });
    const { getByTestId } = render(<Shell />);
    const overlay = getByTestId('overlay');
    expect(overlay.style.top).toBe(`${String(90 + BELOW_TOP_BARS_GAP_PX)}px`);
    expect(overlay.style.maxHeight).toBe(`${String(800 - 98 - 12)}px`);
  });

  it('keeps its stylesheet place without top bars', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(null);
    const { getByTestId } = render(<Shell />);
    expect(getByTestId('overlay').style.top).toBe('');
  });
});
