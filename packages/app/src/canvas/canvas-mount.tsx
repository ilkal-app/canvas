import { useEffect, useRef, type EffectCallback, type ReactElement, type ReactNode } from 'react';

import { useCanvasBackingStore } from '../hooks/use-canvas-backing-store.js';

import type { CanvasBackingSize } from './backing-store-size.js';
import styles from './canvas-mount.module.css';

/** Props of {@link CanvasMount}. */
export interface CanvasMountProps {
  /**
   * Called once the canvas is in the document and sized, with the element the engine renders
   * into. May return a cleanup, run when the canvas unmounts (the engine's dispose). In React's
   * development Strict Mode this runs twice, mount then cleanup then mount, so it must pair up.
   */
  readonly onCanvasReady?: (canvas: HTMLCanvasElement) => ReturnType<EffectCallback>;
  /** Called whenever the canvas's CSS size or drawing buffer size changes, including the first. */
  readonly onCanvasResize?: (size: CanvasBackingSize) => void;
}

/**
 * The main region of the shell, holding the canvas the engine draws into. It fills its grid
 * area, keeps the canvas's drawing buffer at device resolution, and hands the canvas to the
 * engine through `onCanvasReady`.
 *
 * Anything given as children is laid over the canvas, in the canvas's own coordinates (the
 * upload badges).
 *
 * @param props - The mount's callbacks, and what to lay over the canvas.
 * @returns The canvas region.
 */
export function CanvasMount(
  props: CanvasMountProps & { readonly children?: ReactNode },
): ReactElement {
  const { onCanvasReady, onCanvasResize, children } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useCanvasBackingStore(canvasRef, onCanvasResize);

  const onCanvasReadyRef = useRef(onCanvasReady);
  useEffect(() => {
    onCanvasReadyRef.current = onCanvasReady;
  }, [onCanvasReady]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    return onCanvasReadyRef.current?.(canvas);
  }, []);

  return (
    <main className={styles.mount} aria-label="Canvas">
      <canvas ref={canvasRef} className={styles.canvas} />
      {children}
    </main>
  );
}
