// The chime the Facilitate card plays when the board timer runs out: two short tones made
// with Web Audio (no asset to load). Browsers let a page play sound only after a person's gesture
// on it, so the chime stays silent until the page has had a pointer press or a key press, and a
// muted device never plays. Main thread.

/** The parts of Web Audio the chime uses. */
export type ChimeAudio = Pick<
  AudioContext,
  'currentTime' | 'destination' | 'createOscillator' | 'createGain' | 'resume' | 'close'
>;

/** Where the chime listens for a gesture and makes its audio. */
export interface ChimeHost {
  /** The window whose pointer and key presses count as a gesture. */
  readonly target: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /** Makes the audio context, on the first chime after a gesture; none where there is no audio. */
  readonly createAudio: (() => ChimeAudio) | undefined;
}

/** The chime: plays once per call, when allowed. */
export interface TimerChime {
  /**
   * Plays the chime, unless no gesture has happened on the page yet or there is no audio.
   *
   * @returns Whether it played.
   */
  play(): boolean;
  /** Stops listening for gestures and closes the audio context, if one was made. */
  dispose(): void;
}

/** The two tones, in Hz, and how long each sounds, in seconds. */
const TONES = [880, 1320] as const;
const TONE_SECONDS = 0.18;

/**
 * Creates the chime for a page.
 *
 * @param host - The window and the audio factory.
 * @returns The chime.
 */
export function createTimerChime(host: ChimeHost): TimerChime {
  let hasGesture = false;
  let audio: ChimeAudio | undefined;
  const onGesture = (): void => {
    hasGesture = true;
  };
  for (const type of ['pointerdown', 'keydown'] as const)
    host.target.addEventListener(type, onGesture);
  return {
    play() {
      if (!hasGesture || host.createAudio === undefined) return false;
      audio ??= host.createAudio();
      void audio.resume();
      TONES.forEach((frequency, index) => {
        if (audio === undefined) return;
        const start = audio.currentTime + index * TONE_SECONDS;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.18, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + TONE_SECONDS);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + TONE_SECONDS);
      });
      return true;
    },
    dispose() {
      for (const type of ['pointerdown', 'keydown'] as const)
        host.target.removeEventListener(type, onGesture);
      void audio?.close();
      audio = undefined;
    },
  };
}

/** The device preference key of the chime's mute. Per device, never shared. */
export const TIMER_MUTE_KEY = 'canvas.facilitation.timerMuted';

/**
 * Whether this device has muted the timer chime.
 *
 * @param storage - The device's storage, if it can be read.
 * @returns Whether muted; not when the storage cannot be read.
 */
export function readTimerMuted(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return storage?.getItem(TIMER_MUTE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Remembers this device's mute, where the storage allows.
 *
 * @param storage - The device's storage, if any.
 * @param isMuted - Whether muted.
 */
export function writeTimerMuted(
  storage: Pick<Storage, 'setItem'> | undefined,
  isMuted: boolean,
): void {
  try {
    storage?.setItem(TIMER_MUTE_KEY, String(isMuted));
  } catch {
    // A private window or blocked storage: the mute lasts this page only.
  }
}
