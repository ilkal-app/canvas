// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EngineFrameReport } from '@canvas/engine';

import type { MountedEngine } from '../../engine/mounted-engine.js';
import { LiveInkChannel } from '../../live-ink/live-ink-channel.js';

import { HostFrameFeed } from './host-frame-feed.js';
import { InkDebugReadout } from './ink-debug-readout.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('InkDebugReadout', () => {
  it('shows the engine, the rates and a stroke’s latencies from the frames', () => {
    vi.useFakeTimers();
    const hostFrames = new HostFrameFeed();
    render(<InkDebugReadout engine={{ hostFrames } as unknown as MountedEngine} />);
    const report = {
      frameTimeMs: 100,
      pointerInputs: [
        { type: 'down', xPx: 0, yPx: 0, buttons: 1, pointerId: 1, timestampMs: 0 },
        { type: 'move', xPx: 0, yPx: 0, buttons: 1, pointerId: 1, timestampMs: 10 },
      ],
    } as unknown as EngineFrameReport;
    act(() => {
      hostFrames.follow(
        report,
        { kind: 'worker', capabilities: { backendName: 'webgl2' } } as never,
        30,
      );
      vi.advanceTimersByTime(300);
    });
    const text = screen.getByText(/engine: worker · webgl2/u).textContent;
    expect(text).toContain('input → drawn: p50 20.0 ms · max 20.0 ms (1)');
    // No live ink overlay listens here, so the engine draws the stroke.
    expect(text).toContain('ink in engine');
    expect(text).toContain('coalesced');
  });

  it('shows the spacing of frames that drew input at 120 Hz, leaving pauses out', () => {
    vi.useFakeTimers();
    const hostFrames = new HostFrameFeed();
    render(<InkDebugReadout engine={{ hostFrames } as unknown as MountedEngine} />);
    const host = { kind: 'worker', capabilities: { backendName: 'webgpu' } } as never;
    const move = (timestampMs: number): EngineFrameReport =>
      ({
        frameTimeMs: timestampMs + 4,
        pointerInputs: [{ type: 'move', xPx: 0, yPx: 0, buttons: 1, pointerId: 1, timestampMs }],
      }) as unknown as EngineFrameReport;
    act(() => {
      for (const start of [0, 2000]) {
        for (let frame = 0; frame < 10; frame += 1) {
          const timeMs = start + frame * (1000 / 120);
          hostFrames.follow(move(timeMs), host, timeMs + 6);
        }
      }
      hostFrames.follow({ frameTimeMs: 2200, pointerInputs: [] } as never, host, 2201);
      vi.advanceTimersByTime(300);
    });
    const text = screen.getByText(/engine: worker · webgpu/u).textContent;
    expect(text).toContain('drawn input every 8.3 ms');
    expect(text).toContain('input → next page frame (not presented)');
  });

  it('leads with input to the overlay’s paint when the ink is on the page, the engine apart', () => {
    vi.useFakeTimers();
    const hostFrames = new HostFrameFeed();
    const liveInk = new LiveInkChannel();
    // The overlay listens, so the ink is on the page.
    liveInk.attach(() => undefined);
    render(<InkDebugReadout engine={{ hostFrames, liveInk } as unknown as MountedEngine} />);
    const host = { kind: 'worker', capabilities: { backendName: 'webgpu' } } as never;
    act(() => {
      for (let paint = 0; paint < 5; paint += 1) {
        const inputMs = paint * (1000 / 60);
        liveInk.painted({ strokeId: 1, inputMs, paintedMs: inputMs + 16 });
      }
      hostFrames.follow(
        {
          frameTimeMs: 60,
          pointerInputs: [
            { type: 'move', xPx: 0, yPx: 0, buttons: 1, pointerId: 1, timestampMs: 0 },
          ],
        } as unknown as EngineFrameReport,
        host,
        67,
      );
      vi.advanceTimersByTime(300);
    });
    const text = screen.getByText(/engine: worker · webgpu · ink on page/u).textContent;
    expect(text).toContain('input → ink painted on page: p50 16.0 ms · max 16.0 ms (5)');
    expect(text).toContain('ink painted every 16.7 ms');
    expect(text).toContain('engine (hidden preview): input → drawn: p50 67.0 ms');
    expect(text).toContain('engine drew input every');
  });

  it('listens to nothing without an engine', () => {
    render(<InkDebugReadout engine={undefined} />);
    expect(screen.getByText(/engine: starting/u)).toBeDefined();
  });
});
