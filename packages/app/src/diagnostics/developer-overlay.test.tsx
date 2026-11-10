// @vitest-environment jsdom
// The toggle with real key events in installed Chrome:
// tooling/scenario/specs/app/developer-overlay.spec.ts.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BenchmarkSample } from '@canvas/engine';

import {
  DEVELOPER_OVERLAY_FPS_POLL_INTERVAL_MS,
  DEVELOPER_OVERLAY_POLL_INTERVAL_MS,
  DeveloperOverlay,
} from './developer-overlay.js';

const COUNTERS = {
  cpuMs: 2.5,
  pastBudgetMs: 0,
  drawCalls: 3,
  uploadedBytes: 16,
  bufferWrites: 1,
  changedObjects: 0,
  visibleRecords: 50_000,
  blankImages: 0,
  placeholderImages: 0,
  visibleImages: 0,
  segments: 0,
  carriedAdmissions: 0,
  lodTransitions: 0,
  lodThrashes: 0,
  atlasRegenerations: 0,
  atlasLookups: 0,
  atlasMisses: 0,
  meshRegenerations: 0,
  vectorTextRuns: 0,
  layersDrawn: 0,
  layersFallbackSmall: 0,
  layersFallbackLimit: 0,
  layersFallbackBudget: 0,
  layerBytes: 0,
  renderPasses: 0,
  pipelineSwitches: 0,
  bindGroupChanges: 0,
};

const SAMPLE: BenchmarkSample = {
  frames: 240,
  runFrames: 900,
  stages: {
    collectChanges: { p50: 0.05, p95: 0.1 },
    draw: { p50: 1.25, p95: 2 },
  },
  passes: { scene: { p50: 3.5, p95: 4.75 } },
  passFrames: { scene: 240 },
  recentFrames: [],
  frameWorkMs: { p50: 5, p90: 7.5, p95: 8.75, max: 36 },
  memory: {
    instanceBuffers: { bytes: 655_360, peakBytes: 655_360 },
    atlases: { bytes: 0, peakBytes: 0 },
    textures: { bytes: 0, peakBytes: 0 },
    meshes: { bytes: 0, peakBytes: 0 },
    uniforms: { bytes: 16, peakBytes: 16 },
    layers: { bytes: 2048, peakBytes: 4096 },
  },
  p50: COUNTERS,
  p90: { ...COUNTERS, cpuMs: 3.5, drawCalls: 5 },
  p95: { ...COUNTERS, cpuMs: 4, drawCalls: 5 },
  max: { ...COUNTERS, cpuMs: 31.5, drawCalls: 6 },
};

function overlay(): HTMLElement {
  return screen.getByRole('region', { name: 'Developer overlay' });
}

// The cells of the row whose header is `label`, in the table named `tableName`.
function rowCells(tableName: string, label: string): string[] {
  const table = within(overlay()).getByRole('table', { name: tableName });
  const header = within(table).getByRole('rowheader', { name: label });
  const row = header.closest('tr');
  if (!row) throw new Error(`No row for ${label}`);
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DeveloperOverlay', () => {
  it('says there are no frame statistics when it has nothing to read', () => {
    render(<DeveloperOverlay />);
    expect(within(overlay()).getByText(/No frame statistics/)).toBeInstanceOf(HTMLElement);
    expect(within(overlay()).queryByRole('table')).toBeNull();
  });

  it('waits for the first frame when the engine has measured none', () => {
    render(<DeveloperOverlay readFrameStats={() => ({ ...SAMPLE, frames: 0 })} />);
    expect(within(overlay()).getByText(/Waiting for the first frame/)).toBeInstanceOf(HTMLElement);
  });

  it('shows the frame time and CPU time per stage as p50 and p95', () => {
    render(<DeveloperOverlay readFrameStats={() => SAMPLE} />);
    expect(within(overlay()).getByText(/240 frames/)).toBeInstanceOf(HTMLElement);
    expect(within(overlay()).getByText(/slowest of 900: 31.50 ms/)).toBeInstanceOf(HTMLElement);
    expect(rowCells('CPU time per stage', 'Frame')).toEqual(['2.50 ms', '4.00 ms']);
    expect(rowCells('CPU time per stage', 'collectChanges')).toEqual(['0.05 ms', '0.10 ms']);
    expect(rowCells('CPU time per stage', 'draw')).toEqual(['1.25 ms', '2.00 ms']);
  });

  it('shows GPU time per pass, or says the GPU cannot time passes', () => {
    render(<DeveloperOverlay readFrameStats={() => SAMPLE} />);
    expect(rowCells('GPU time per pass', 'scene')).toEqual(['3.50 ms', '4.75 ms']);
    cleanup();
    render(<DeveloperOverlay readFrameStats={() => ({ ...SAMPLE, passes: {} })} />);
    expect(within(overlay()).queryByRole('table', { name: 'GPU time per pass' })).toBeNull();
    expect(within(overlay()).getByText(/No GPU pass timings/)).toBeInstanceOf(HTMLElement);
  });

  it('shows GPU memory per category, now and at its peak', () => {
    render(<DeveloperOverlay readFrameStats={() => SAMPLE} />);
    expect(rowCells('GPU memory', 'Instance buffers')).toEqual(['640.0 KiB', '640.0 KiB']);
    expect(rowCells('GPU memory', 'Glyph atlases')).toEqual(['0 B', '0 B']);
    expect(rowCells('GPU memory', 'Textures')).toEqual(['0 B', '0 B']);
    expect(rowCells('GPU memory', 'Path meshes')).toEqual(['0 B', '0 B']);
    expect(rowCells('GPU memory', 'Uniforms')).toEqual(['16 B', '16 B']);
    expect(rowCells('GPU memory', 'Layers')).toEqual(['2.0 KiB', '4.0 KiB']);
  });

  it('shows draw calls, uploads and visible records per frame', () => {
    render(<DeveloperOverlay readFrameStats={() => SAMPLE} />);
    expect(rowCells('Per frame', 'Draw calls')).toEqual(['3', '5']);
    expect(rowCells('Per frame', 'Uploaded')).toEqual(['16 B', '16 B']);
    expect(rowCells('Per frame', 'Buffer writes')).toEqual(['1', '1']);
    expect(rowCells('Per frame', 'Changed objects')).toEqual(['0', '0']);
    expect(rowCells('Per frame', 'Visible records')).toEqual(['50,000', '50,000']);
  });

  it('reads the statistics at 4 Hz, not on every frame', () => {
    expect(DEVELOPER_OVERLAY_POLL_INTERVAL_MS).toBe(250);
    let cpuMs = 2.5;
    const read = vi.fn(() => ({ ...SAMPLE, p50: { ...COUNTERS, cpuMs } }));
    render(<DeveloperOverlay readFrameStats={read} />);
    expect(read).toHaveBeenCalledTimes(1);
    cpuMs = 7;
    act(() => {
      vi.advanceTimersByTime(DEVELOPER_OVERLAY_POLL_INTERVAL_MS);
    });
    expect(rowCells('CPU time per stage', 'Frame')[0]).toBe('7.00 ms');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(read).toHaveBeenCalledTimes(6);
  });

  it('shows the current and the lowest frames-per-second, from the engine’s own frames', () => {
    const frames = Array.from({ length: 300 }, (unused, index) => index * (1000 / 60));
    const nowMs = frames[frames.length - 1] ?? 0;
    render(<DeveloperOverlay readFrameTimesMs={() => frames} now={() => nowMs} />);
    expect(rowCells('Frame rate', 'FPS')).toEqual(['60 fps', '60 fps']);
  });

  it('says the frame rate is idle rather than 0 fps when nothing was drawn recently', () => {
    render(<DeveloperOverlay readFrameTimesMs={() => []} now={() => 1_000} />);
    expect(rowCells('Frame rate', 'FPS')).toEqual(['idle', 'idle']);
  });

  it('leaves the frame rate out without a reader for it', () => {
    render(<DeveloperOverlay readFrameStats={() => SAMPLE} />);
    expect(within(overlay()).queryByRole('table', { name: 'Frame rate' })).toBeNull();
  });

  it('updates the frame rate at most about twice a second, not on every frame-stats poll', () => {
    const read = vi.fn(() => [0]);
    render(<DeveloperOverlay readFrameTimesMs={read} now={() => 0} />);
    expect(read).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(DEVELOPER_OVERLAY_POLL_INTERVAL_MS);
    });
    // A frame-stats poll (250 ms) alone must not read the frame times again.
    expect(read).toHaveBeenCalledTimes(1);
    act(() => {
      const remainingMs =
        DEVELOPER_OVERLAY_FPS_POLL_INTERVAL_MS - DEVELOPER_OVERLAY_POLL_INTERVAL_MS;
      vi.advanceTimersByTime(remainingMs);
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('shows what an engine in a worker answers later, and waits for it until then', async () => {
    let answer: (sample: typeof SAMPLE) => void = () => undefined;
    render(
      <DeveloperOverlay
        readFrameStats={() =>
          new Promise((resolve) => {
            answer = resolve;
          })
        }
      />,
    );
    expect(within(overlay()).getByText(/Waiting for frame statistics/)).toBeInstanceOf(HTMLElement);
    await act(async () => {
      answer(SAMPLE);
      await Promise.resolve();
    });
    expect(within(overlay()).getByText(/240 frames/)).toBeInstanceOf(HTMLElement);
  });
});
