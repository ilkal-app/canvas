import type { EngineHost } from '@canvas/engine';

/** A canvas's engine host and who holds it. */
interface Lease {
  readonly host: Promise<EngineHost>;
  holders: number;
  releaseTimer: ReturnType<typeof setTimeout> | undefined;
}

const leases = new WeakMap<HTMLCanvasElement, Lease>();

/** A hold on a canvas's engine host. */
export interface EngineHostHold {
  /** The host, once started. */
  readonly host: Promise<EngineHost>;
  /** Lets go of the host; once nobody holds it after this task, it is destroyed. */
  readonly release: () => void;
}

/**
 * Holds the engine host of a canvas, starting it on the first hold. A canvas can hand its control
 * to a worker only once, so the host outlives an unmount that is followed, in the same task, by
 * a mount of the same canvas, as React's development Strict Mode does to every effect: the last
 * release destroys the host only after the current task, and a hold taken before then keeps it.
 * Main thread.
 *
 * @param canvas - The canvas the engine draws into.
 * @param start - Starts the host; called only when the canvas has none.
 * @returns The hold.
 */
export function holdEngineHost(
  canvas: HTMLCanvasElement,
  start: () => Promise<EngineHost>,
): EngineHostHold {
  let lease = leases.get(canvas);
  if (lease === undefined) {
    lease = { host: start(), holders: 0, releaseTimer: undefined };
    leases.set(canvas, lease);
  }
  const held = lease;
  clearTimeout(held.releaseTimer);
  held.releaseTimer = undefined;
  held.holders += 1;
  let isReleased = false;
  return {
    host: held.host,
    release: () => {
      if (isReleased) return;
      isReleased = true;
      held.holders -= 1;
      if (held.holders > 0) return;
      held.releaseTimer = setTimeout(() => {
        leases.delete(canvas);
        // A host that never started has nothing to destroy; its failure was reported to its holders.
        held.host.then(
          (host) => {
            host.destroy();
          },
          () => undefined,
        );
      }, 0);
    },
  };
}
