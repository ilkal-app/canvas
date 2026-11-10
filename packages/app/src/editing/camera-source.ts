import type { Camera } from '@canvas/engine';

/**
 * The camera as the shell's canvas layers read it (the text bar and the editing labels
 * follow what they sit on): the engine writes each camera it shows (`onCameraChange`), the layers
 * subscribe, so a pan or a zoom re-renders them alone, and only while they show something.
 */
export interface CameraSource {
  /** The camera now; undefined until the engine reported one. */
  readonly read: () => Camera | undefined;
  /** Writes a camera; subscribers are told only when a field changed. */
  readonly write: (camera: Camera) => void;
  /** Listens for changes; returns what stops listening. */
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * Whether two cameras show the same view.
 *
 * @param first - A camera, or undefined.
 * @param second - Another.
 * @returns True when every field matches.
 */
function isSameCamera(first: Camera | undefined, second: Camera): boolean {
  return (
    first?.x === second.x &&
    first.y === second.y &&
    first.zoom === second.zoom &&
    first.viewportWidthPx === second.viewportWidthPx &&
    first.viewportHeightPx === second.viewportHeightPx &&
    first.dpr === second.dpr
  );
}

/**
 * A camera source with no camera yet.
 *
 * @returns The source.
 */
export function createCameraSource(): CameraSource {
  let camera: Camera | undefined;
  const listeners = new Set<() => void>();
  return {
    read: () => camera,
    write: (next) => {
      if (isSameCamera(camera, next)) return;
      camera = next;
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
