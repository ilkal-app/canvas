/**
 * The camera's zoom as the zoom control reads it: the engine writes each camera it shows, the
 * control subscribes, so a zoom re-renders the control alone and not the shell (a wheel zoom
 * sweep writes on every step).
 */
export interface ZoomSource {
  /** The zoom now, CSS px per world unit; undefined until the engine reported a camera. */
  readonly read: () => number | undefined;
  /** Writes the zoom (CSS px per world unit); subscribers are told only when it changed. */
  readonly write: (zoom: number) => void;
  /** Listens for changes; returns what stops listening. */
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * A zoom source with no zoom yet.
 *
 * @returns The source.
 */
export function createZoomSource(): ZoomSource {
  let zoom: number | undefined;
  const listeners = new Set<() => void>();
  return {
    read: () => zoom,
    write: (next) => {
      if (next === zoom) return;
      zoom = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
