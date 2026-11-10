import type { FrameStage } from '../scene/frame-context.js';
import type { Frame } from '../scene/frame.js';

import type { StageTimers } from './stage-timers.js';

/** A {@link installStageTimers} result: what was wrapped, and the way back. */
export interface StageTimersInstallation {
  /** The stages being timed, in run order: the frame's stages when it was installed. */
  readonly stageNames: readonly string[];
  /** Whether the wrappers are still in the frame. */
  readonly isInstalled: boolean;
  /**
   * Puts back every stage exactly as it was, so a frame without timers pays nothing for them.
   * Does nothing when already uninstalled.
   *
   * @throws {Error} When a wrapper added after installing sits on top of one of the timed
   *   stages; nothing is changed then. Uninstall wrappers in the reverse order of installing.
   */
  uninstall(): void;
}

/** Every timing wrapper ever made, so a second installation on the same stages is refused. */
const TIMING_WRAPPERS = new WeakSet<FrameStage>();

/** One wrapped stage: the stage as it was, and the timing wrapper that replaced it. */
interface WrappedStage {
  readonly original: FrameStage;
  readonly wrapper: FrameStage;
}

/**
 * Times a frame: wraps
 * each of its stages with `Frame.wrapStage`, so every stage reports to the timers' hook
 * (`stageStarted`/`stageEnded`, even when it throws), the first stage also begins the frame's
 * record and the last one ends it. Install once the frame is assembled: a stage inserted later
 * runs untimed, and one inserted before the first or after the last runs outside the frame's
 * CPU time. Uninstalling restores the original stage objects, the way the overlay's toggle
 * turns measuring off.
 *
 * @param frame - The frame to time, usually `SceneRenderer.frame`.
 * @param timers - Where the measurements go.
 * @returns The installation, to uninstall it.
 * @throws {Error} When a stage of the frame is already timed; nothing is changed then.
 */
export function installStageTimers(frame: Frame, timers: StageTimers): StageTimersInstallation {
  const stageNames = frame.stageNames;
  for (const name of stageNames) {
    frame.wrapStage(name, (current) => {
      if (TIMING_WRAPPERS.has(current)) {
        throw new Error(`Stage "${name}" is already timed; uninstall those timers first.`);
      }
      return current;
    });
  }
  const wrapped = new Map<string, WrappedStage>();
  stageNames.forEach((name, index) => {
    frame.wrapStage(name, (original) => {
      const wrapper = timedStage(original, timers, index === 0, index === stageNames.length - 1);
      TIMING_WRAPPERS.add(wrapper);
      wrapped.set(name, { original, wrapper });
      return wrapper;
    });
  });
  let isInstalled = true;
  return {
    stageNames,
    get isInstalled() {
      return isInstalled;
    },
    uninstall() {
      if (!isInstalled) return;
      for (const [name, { wrapper }] of wrapped) {
        frame.wrapStage(name, (current) => {
          if (current !== wrapper) {
            throw new Error(
              `Stage "${name}" was wrapped again after its timers were installed; ` +
                'uninstall that wrapper first.',
            );
          }
          return current;
        });
      }
      for (const [name, { original }] of wrapped) frame.wrapStage(name, () => original);
      isInstalled = false;
    },
  };
}

/**
 * A stage that reports to the timers around the stage it wraps.
 *
 * @param inner - The stage to time.
 * @param timers - The timers.
 * @param isFirst - Whether it begins the frame's record.
 * @param isLast - Whether it ends the frame's record.
 * @returns The wrapper, with the inner stage's name.
 */
function timedStage(
  inner: FrameStage,
  timers: StageTimers,
  isFirst: boolean,
  isLast: boolean,
): FrameStage {
  const { name } = inner;
  return {
    name,
    run(context) {
      if (isFirst) timers.beginFrame(context);
      timers.stageStarted(name);
      try {
        inner.run(context);
      } finally {
        timers.stageEnded(name);
      }
      if (isLast) timers.endFrame(context);
    },
  };
}
