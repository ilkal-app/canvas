import { describe, expect, it, vi } from 'vitest';

import {
  createTimerChime,
  readTimerMuted,
  TIMER_MUTE_KEY,
  writeTimerMuted,
  type ChimeAudio,
} from './timer-chime.js';

/**
 * A fake audio context counting the tones it was asked to play.
 *
 * @returns The fake and its tone count.
 */
function fakeAudio(): {
  readonly audio: ChimeAudio;
  readonly started: () => number;
  readonly closed: () => number;
} {
  let started = 0;
  let closed = 0;
  const param = { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  const audio = {
    currentTime: 0,
    destination: {} as AudioNode,
    createOscillator: () => ({
      type: 'sine' as OscillatorType,
      frequency: param as unknown as AudioParam,
      connect: vi.fn(),
      start: () => (started += 1),
      stop: vi.fn(),
    }),
    createGain: () => ({ gain: param as unknown as AudioParam, connect: vi.fn() }),
    resume: () => Promise.resolve(),
    close: () => {
      closed += 1;
      return Promise.resolve();
    },
  } as unknown as ChimeAudio;
  return { audio, started: () => started, closed: () => closed };
}

describe('the timer chime', () => {
  it('stays silent until a gesture on the page, then plays two tones', () => {
    const target = new EventTarget();
    const { audio, started, closed } = fakeAudio();
    const createAudio = vi.fn(() => audio);
    const chime = createTimerChime({ target: target, createAudio });
    expect(chime.play()).toBe(false);
    expect(createAudio).not.toHaveBeenCalled();
    target.dispatchEvent(new Event('keydown'));
    expect(chime.play()).toBe(true);
    expect(chime.play()).toBe(true);
    expect(started()).toBe(4);
    expect(createAudio).toHaveBeenCalledOnce();
    chime.dispose();
    expect(closed()).toBe(1);
  });

  it('never plays without audio, and stops listening once disposed', () => {
    const target = new EventTarget();
    const silent = createTimerChime({
      target: target,
      createAudio: undefined,
    });
    target.dispatchEvent(new Event('pointerdown'));
    expect(silent.play()).toBe(false);
    const { audio } = fakeAudio();
    const chime = createTimerChime({
      target: target,
      createAudio: () => audio,
    });
    chime.dispose();
    target.dispatchEvent(new Event('pointerdown'));
    expect(chime.play()).toBe(false);
  });

  it('remembers the mute per device, and survives storage that throws', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(readTimerMuted(storage)).toBe(false);
    writeTimerMuted(storage, true);
    expect(values.get(TIMER_MUTE_KEY)).toBe('true');
    expect(readTimerMuted(storage)).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readTimerMuted(broken)).toBe(false);
    expect(() => {
      writeTimerMuted(broken, true);
    }).not.toThrow();
    expect(readTimerMuted(undefined)).toBe(false);
  });
});
