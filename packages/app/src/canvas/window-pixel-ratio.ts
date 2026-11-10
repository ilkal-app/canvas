/**
 * The window's device pixel ratio, which the mounts give the engine's camera as its `dpr`; 1
 * where there is no window (tests, workers).
 *
 * @returns The ratio.
 */
export function windowPixelRatio(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio;
}
