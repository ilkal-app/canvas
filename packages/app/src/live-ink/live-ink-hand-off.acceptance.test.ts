import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  EngineFrameReport,
  EngineHost,
  EngineInputsCompleted,
  InputMark,
} from '@canvas/engine';

import type { HostView } from '../engine/host-view.js';

import type { LiveInkModel } from './live-ink-channel.js';
import { HAND_OFF_LIMIT_MS, liveInkHandOff, mountLiveInk } from './live-ink-hand-off.js';

function fixture(options: { hasView?: boolean; hasCompletions?: boolean } = {}) {
  const completions = new Set<(completion: EngineInputsCompleted) => void>();
  const frames = new Set<(report: EngineFrameReport) => void>();
  const markInput = vi.fn<(mark: InputMark) => void>();
  const host = {
    onInputsCompleted:
      options.hasCompletions === false
        ? undefined
        : (listener: (completion: EngineInputsCompleted) => void) => {
            completions.add(listener);
            return () => {
              completions.delete(listener);
            };
          },
    onFrame: (listener: (report: EngineFrameReport) => void) => {
      frames.add(listener);
      return () => {
        frames.delete(listener);
      };
    },
  } as unknown as EngineHost;
  const view = options.hasView === false ? undefined : ({ markInput } as unknown as HostView);
  const handOff = liveInkHandOff(() => ({ host, view }));
  const complete = (frameIndex: number, hasPendingWork: boolean, marks: InputMark[]) => {
    const completion = {
      frameIndex,
      frameTimeMs: frameIndex * 16,
      completedMs: frameIndex * 16 + 1,
      hasPendingWork,
      marks,
    };
    for (const listener of [...completions]) listener(completion);
  };
  const frame = (frameIndex: number, hasPendingWork: boolean) => {
    const report = { frameIndex, hasPendingWork } as EngineFrameReport;
    for (const listener of [...frames]) listener(report);
  };
  return { handOff, markInput, complete, frame, completions, frames };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
});

describe('live ink engine hand-off', () => {
  it('marks the view with ink-handoff and waits for its own completed mark without pending work', () => {
    const f = fixture();
    const drawn = vi.fn();
    f.handOff(drawn);
    expect(f.markInput).toHaveBeenCalledTimes(1);
    const mark = f.markInput.mock.calls[0]?.[0];
    expect(mark).toMatchObject({ kind: 'ink-handoff', id: 1_000_000_000 });
    if (mark === undefined) throw new Error('Expected an ink hand-off mark.');
    f.complete(1, false, [{ ...mark, id: mark.id + 1 }]);
    expect(drawn).not.toHaveBeenCalled();
    f.complete(2, false, [mark]);
    expect(drawn).toHaveBeenCalledTimes(1);
    expect(f.completions.size).toBe(0);
  });

  it('marks again after pending work and waits for that mark to complete cleanly', () => {
    const f = fixture();
    const drawn = vi.fn();
    f.handOff(drawn);
    const firstMark = f.markInput.mock.calls[0]?.[0];
    if (firstMark === undefined) throw new Error('Expected an ink hand-off mark.');
    expect(f.frames.size).toBe(0);
    f.complete(5, true, [firstMark]);
    expect(f.markInput).toHaveBeenCalledTimes(2);
    const secondMark = f.markInput.mock.calls[1]?.[0];
    expect(secondMark).toMatchObject({ kind: 'ink-handoff', id: firstMark.id + 1 });
    if (secondMark === undefined) throw new Error('Expected a second ink hand-off mark.');
    expect(drawn).not.toHaveBeenCalled();
    f.frame(6, false);
    expect(drawn).not.toHaveBeenCalled();
    f.complete(7, false, [secondMark]);
    expect(drawn).toHaveBeenCalledTimes(1);
    expect(f.completions.size).toBe(0);
    expect(f.frames.size).toBe(0);

    const cancel = f.handOff(drawn);
    const cancelledMark = f.markInput.mock.calls[2]?.[0];
    if (cancelledMark === undefined) throw new Error('Expected another ink hand-off mark.');
    cancel();
    f.complete(8, false, [cancelledMark]);
    expect(drawn).toHaveBeenCalledTimes(1);
  });

  it('finishes at the 1000 ms limit and calls drawn once at most', () => {
    const f = fixture();
    const drawn = vi.fn();
    f.handOff(drawn);
    const mark = f.markInput.mock.calls[0]?.[0];
    if (mark === undefined) throw new Error('Expected an ink hand-off mark.');
    vi.advanceTimersByTime(HAND_OFF_LIMIT_MS - 1);
    expect(drawn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(drawn).toHaveBeenCalledTimes(1);
    f.complete(1, false, [mark]);
    f.frame(2, false);
    vi.advanceTimersByTime(HAND_OFF_LIMIT_MS);
    expect(drawn).toHaveBeenCalledTimes(1);
  });

  it('cancel stops completion, frames and the limit', () => {
    const f = fixture();
    const drawn = vi.fn();
    const cancel = f.handOff(drawn);
    const mark = f.markInput.mock.calls[0]?.[0];
    if (mark === undefined) throw new Error('Expected an ink hand-off mark.');
    f.complete(1, true, [mark]);
    cancel();
    expect(f.completions.size).toBe(0);
    expect(f.frames.size).toBe(0);
    f.complete(2, false, [mark]);
    f.frame(3, false);
    vi.advanceTimersByTime(HAND_OFF_LIMIT_MS);
    expect(drawn).not.toHaveBeenCalled();
  });

  it.each([
    { description: 'no view', options: { hasView: false } },
    { description: 'no completion callback', options: { hasCompletions: false } },
  ] as const)('calls drawn at once with $description', ({ options }) => {
    const f = fixture(options);
    const drawn = vi.fn();
    f.handOff(drawn);
    expect(drawn).toHaveBeenCalledTimes(1);
    expect(f.markInput).not.toHaveBeenCalled();
  });

  it('mountLiveInk cancels each unfinished stroke hand-off on destroy', () => {
    const f = fixture();
    const channel = mountLiveInk(() => ({
      host: {
        onInputsCompleted: (listener: (completion: EngineInputsCompleted) => void) => {
          f.completions.add(listener);
          return () => {
            f.completions.delete(listener);
          };
        },
        onFrame: (listener: (report: EngineFrameReport) => void) => {
          f.frames.add(listener);
          return () => {
            f.frames.delete(listener);
          };
        },
      } as unknown as EngineHost,
      view: { markInput: f.markInput } as unknown as HostView,
    }));
    const models = vi.fn<(model: LiveInkModel) => void>();
    channel.attach(models);
    channel.show([]);
    channel.release();
    channel.show([]);
    channel.release();
    expect(f.markInput.mock.calls.map(([mark]) => mark.id)).toEqual([1_000_000_000, 1_000_000_001]);
    channel.destroy();
    expect(f.completions.size).toBe(0);
    vi.advanceTimersByTime(HAND_OFF_LIMIT_MS);
    expect(models.mock.calls.map(([model]) => model.phase)).toEqual([
      'drawing',
      'released',
      'drawing',
      'released',
    ]);
  });
});
