import type { EngineHost } from '@canvas/engine';

import type { HostView } from '../engine/host-view.js';

import { LiveInkChannel } from './live-ink-channel.js';

/**
 * How long a written stroke waits for the engine to show it, ms, past which the overlay lets it
 * go anyway: a mark is dropped when its frame's GPU work fails (a lost device) and the host that
 * replaces it draws the written stroke from the document.
 */
export const HAND_OFF_LIMIT_MS = 1_000;

/**
 * The first id of the overlay's marks: far from the benchmark's own, which count up from one, so
 * two marks of one frame are never confused (`InputMark.id`).
 */
const FIRST_MARK_ID = 1_000_000_000;

/**
 * Waits for the engine to show a stroke just written, then calls `drawn`; returns a
 * cancel. The live ink overlay keeps the stroke until then.
 */
export type LiveInkHandOff = (drawn: () => void) => () => void;

/** A mount's engine now: its host and its view of it, while it runs. */
export interface RunningEngine {
  readonly host: EngineHost | undefined;
  readonly view: HostView | undefined;
}

/**
 * The live ink hand-off of a mount. A written stroke's change is queued in the view;
 * an `ink-handoff` input mark is queued after it, so the frame that takes the mark has the stroke
 * in its scene. Once that frame's GPU work is done (`onInputsCompleted`) and it left no work
 * (its meshes all built), the stroke is on screen. A marked frame that left work is followed by
 * another mark, until one's frame is done with none: a frame without a mark reports no GPU
 * completion, so only a marked frame tells. At the latest after {@link HAND_OFF_LIMIT_MS}.
 * Without a view or a host that reports marks, the stroke is let go at once.
 *
 * @param running - The mount's host and view now.
 * @returns The hand-off.
 */
export function liveInkHandOff(running: () => RunningEngine): LiveInkHandOff {
  let nextId = FIRST_MARK_ID;
  return (drawn) => {
    const { host, view } = running();
    if (view === undefined || host?.onInputsCompleted === undefined) {
      drawn();
      return () => undefined;
    }
    // This stroke's marks: one after the write, and one more each time a marked frame left work.
    const ids = new Set<number>();
    const mark = (): void => {
      const id = nextId;
      nextId += 1;
      ids.add(id);
      const now = performance.now();
      view.markInput({ kind: 'ink-handoff', id, timestampMs: now, markedMs: now });
    };
    let isDone = false;
    const stop = (): void => {
      isDone = true;
      stopCompletions();
      clearTimeout(limit);
    };
    const stopCompletions = host.onInputsCompleted((completion) => {
      if (isDone) return;
      const isOurs = completion.marks.some(
        (candidate) => candidate.kind === 'ink-handoff' && ids.has(candidate.id),
      );
      if (!isOurs) return;
      if (completion.hasPendingWork) {
        mark();
        return;
      }
      stop();
      drawn();
    });
    const limit = setTimeout(() => {
      if (isDone) return;
      stop();
      drawn();
    }, HAND_OFF_LIMIT_MS);
    mark();
    return stop;
  };
}

/**
 * A mount's live ink channel, its written strokes handed off to the mount's engine.
 *
 * @param running - The mount's host and view now.
 * @returns The channel.
 */
export function mountLiveInk(running: () => RunningEngine): LiveInkChannel {
  return new LiveInkChannel(liveInkHandOff(running));
}
