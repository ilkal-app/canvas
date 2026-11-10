// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBenchmarkSample, FrameHistory, type RecentFrame } from '@canvas/engine';

import { DEVELOPER_OVERLAY_POLL_INTERVAL_MS, DeveloperOverlay } from './developer-overlay.js';
import { FrameDebugView } from './frame-debug-view.js';

const FRAMES: readonly RecentFrame[] = [
  {
    frameIndex: 17,
    cpuMs: 8.25,
    stageMs: { collect: 2, draw: 6 },
    drawCalls: 2,
    segments: 3,
    visibleRecords: 500,
    renderPasses: 1,
    pipelineSwitches: 2,
    pastBudgetMs: 0,
  },
  {
    frameIndex: 18,
    cpuMs: 20,
    stageMs: { collect: 0, draw: 20 },
    drawCalls: 1_234,
    segments: 5,
    visibleRecords: 50_000,
    renderPasses: 4,
    pipelineSwitches: 6,
    pastBudgetMs: 3.33,
  },
];

function newestRow(label: string): string {
  const table = screen.getByRole('table', { name: 'Newest frame' });
  const header = within(table).getByRole('rowheader', { name: label });
  const row = header.closest('tr');
  if (row === null) throw new Error(`No row for ${label}`);
  return within(row).getByRole('cell').textContent;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('FrameDebugView', () => {
  it('shows one bar per frame with accessible CPU time and measured stage segments', () => {
    render(<FrameDebugView frames={FRAMES} />);
    const bars = screen.getAllByRole('img');
    expect(bars.map((bar) => bar.getAttribute('aria-label'))).toEqual([
      'Frame 17: 8.25 ms CPU',
      'Frame 18: 20.00 ms CPU',
    ]);
    const firstBar = screen.getByRole('img', { name: 'Frame 17: 8.25 ms CPU' });
    const secondBar = screen.getByRole('img', { name: 'Frame 18: 20.00 ms CPU' });
    const collect = within(firstBar).getByTitle('collect 2.00 ms');
    expect(collect).toBeInstanceOf(HTMLElement);
    expect(Number.parseFloat(collect.style.width)).toBeCloseTo(12);
    expect(within(firstBar).getByTitle('draw 6.00 ms')).toBeInstanceOf(HTMLElement);
    expect(within(secondBar).queryByTitle('collect 0.00 ms')).toBeNull();
    const overBudgetDraw = within(secondBar).getByTitle('draw 20.00 ms');
    expect(Number.parseFloat(overBudgetDraw.style.width)).toBeCloseTo(120);
  });

  it('shows the newest frame counters using the overlay count and millisecond formats', () => {
    render(<FrameDebugView frames={FRAMES} />);
    expect(newestRow('Draw calls')).toBe('1,234');
    expect(newestRow('Segments')).toBe('5');
    expect(newestRow('Visible records')).toBe('50,000');
    expect(newestRow('Render passes')).toBe('4');
    expect(newestRow('Pipeline switches')).toBe('6');
    expect(newestRow('Past budget')).toBe('3.33 ms');
  });

  it('says when there are no frames yet', () => {
    render(<FrameDebugView frames={[]} />);
    expect(screen.getByText(/no frames yet/i)).toBeInstanceOf(HTMLElement);
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('DeveloperOverlay frame bars', () => {
  it('toggles bars from the same 4 Hz sample without starting another poll', () => {
    const sample = {
      ...createBenchmarkSample(new FrameHistory()),
      frames: 2,
      recentFrames: FRAMES,
    };
    const read = vi.fn(() => sample);
    render(<DeveloperOverlay readFrameStats={read} />);

    const toggle = screen.getByRole('button', { name: 'Frame bars' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('img', { name: 'Frame 18: 20.00 ms CPU' })).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('img', { name: 'Frame 18: 20.00 ms CPU' })).toBeInstanceOf(HTMLElement);
    expect(read).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(DEVELOPER_OVERLAY_POLL_INTERVAL_MS);
    });
    expect(read).toHaveBeenCalledTimes(2);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('img', { name: 'Frame 18: 20.00 ms CPU' })).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });
});
