import type { EngineHost, SceneStamp, SerializableChangeSet } from '@canvas/engine';

const streams = new WeakMap<EngineHost, SceneStamp>();
let nextSession = 0;

/**
 * Sends a batch in the host's one contiguous stream, including preview-to-live replacement.
 * The identity describes renderer input, not authoritative snapshot ownership: callers must
 * separately exclude ephemeral tool previews before publishing a document projection.
 *
 * @param host - The existing mounted host.
 * @param changes - Owned serializable scene data.
 * @returns A copy of the revision assigned to this batch.
 */
export function enqueueHostScene(host: EngineHost, changes: SerializableChangeSet): SceneStamp {
  const previous = streams.get(host);
  const stamp =
    previous === undefined
      ? { session: `mount-${String(++nextSession)}`, sequence: 0 }
      : { session: previous.session, sequence: previous.sequence + 1 };
  streams.set(host, stamp);
  host.applyChangeSet(changes, { ...stamp });
  return { ...stamp };
}

/**
 * Captures the latest enqueued revision; only a renderer certificate proves it was drawn.
 *
 * @param host - The mounted host.
 * @returns An owned stamp, or undefined before its first scene batch.
 */
export function readHostSceneStamp(host: EngineHost): SceneStamp | undefined {
  const stamp = streams.get(host);
  return stamp === undefined ? undefined : { ...stamp };
}
