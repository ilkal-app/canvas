import { useEffect, useRef, useState, type ReactElement } from 'react';

import type { Camera } from '@canvas/engine';
import type { FreehandObject } from '@canvas/schema';

import type { CameraSource } from '../editing/camera-source.js';
import type { BoardView } from '../engine/board-view.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import type { ThemeName } from '../theme/theme-tokens.js';

import type { LiveInkChannel, LiveInkModel } from './live-ink-channel.js';
import { drawLiveInk, type InkContext } from './live-ink-drawing.js';
import styles from './live-ink-overlay.module.css';

/** Props of {@link LiveInkOverlay}. */
export interface LiveInkOverlayProps {
  /** The engine, once it runs: its live ink channel and camera. */
  readonly engine: MountedEngine | undefined;
  /** The camera, if the engine reports one; the engine's own camera when absent. */
  readonly camera: CameraSource | undefined;
  /** The viewer's theme, for a stroke in a token or the theme's ink; light when absent. */
  readonly themeName?: ThemeName;
  /** The board, whose colour tokens colour a stroke in a token; none when absent. */
  readonly board?: BoardView | undefined;
}

/** A canvas the overlay's size for translucent pieces (`drawLiveInk`). */
interface InkLayer {
  readonly canvas: HTMLCanvasElement;
  readonly context: InkContext;
}

/** The strokes the overlay shows, by id: the one under way and those not yet handed off. */
type InkStrokes = Map<number, readonly FreehandObject[]>;

/** The newest input the stroke under way took that the overlay has not yet painted. */
interface UnpaintedInput {
  readonly strokeId: number;
  readonly inputMs: number;
}

/** Where the overlay keeps the newest input not yet painted: a paint takes it. */
interface UnpaintedSlot {
  current: UnpaintedInput | undefined;
}

/**
 * Sizes a canvas's backing store.
 *
 * @param canvas - The canvas.
 * @param width - Its width, device px.
 * @param height - Its height, device px.
 */
function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

/**
 * Whether the page can draw the overlay: a canvas there gives a 2D context. Without one the
 * overlay never listens, so the draw tool keeps the engine's visible previews.
 *
 * @param document - The page's document.
 * @returns True when a 2D context is available.
 */
function canDrawInk(document: Document): boolean {
  return document.createElement('canvas').getContext('2d') !== null;
}

/**
 * Takes what the channel says of one stroke into the strokes shown: the stroke under way and a
 * written one stay (a written one until the engine shows it, even while the next is drawn); one
 * the engine shows, or one dropped, goes.
 *
 * @param strokes - The strokes shown, updated.
 * @param model - The stroke and its phase.
 */
function takeInk(strokes: InkStrokes, model: LiveInkModel): void {
  if (model.phase === 'drawing' || model.phase === 'released') {
    strokes.set(model.strokeId, model.pieces);
  } else {
    strokes.delete(model.strokeId);
  }
}

/**
 * Draws the strokes shown on the overlay's canvas, at most once a page animation frame after
 * they or the camera changed.
 */
class LiveInkPainter {
  private request: number | undefined;
  private layer: InkLayer | undefined;
  private isShowing = false;
  private readonly context: InkContext | null;
  private readonly stopCamera: (() => void) | undefined;

  /**
   * Starts following the camera, with the canvas's 2D context, and draws what is shown.
   *
   * @param canvas - The overlay's canvas.
   * @param strokes - The strokes shown, which the overlay keeps.
   * @param unpainted - The newest input not yet painted, which the overlay keeps; a paint takes it.
   * @param engine - The engine: its camera.
   * @param camera - The camera, if the engine reports one.
   * @param palette - The viewer's theme and the board.
   * @param palette.themeName - The viewer's theme.
   * @param palette.board - The board, whose colour tokens colour a stroke in a token.
   */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly strokes: InkStrokes,
    private readonly unpainted: UnpaintedSlot,
    private readonly engine: MountedEngine,
    private readonly camera: CameraSource | undefined,
    private readonly palette: {
      readonly themeName: ThemeName;
      readonly board: BoardView | undefined;
    },
  ) {
    this.context = canvas.getContext('2d');
    this.fit();
    this.stopCamera = camera?.subscribe(() => {
      this.fit();
      if (this.strokes.size > 0) this.schedule();
    });
    this.schedule();
  }

  /** Stops following and drawing. */
  destroy(): void {
    this.stopCamera?.();
    if (this.request !== undefined) cancelAnimationFrame(this.request);
  }

  /** Draws the strokes shown again at the next page animation frame. */
  schedule(): void {
    this.request ??= requestAnimationFrame(() => {
      this.request = undefined;
      this.draw();
    });
  }

  private draw(): void {
    const { context } = this;
    if (context === null) return;
    const { camera, width, height } = this.fit();
    if (this.strokes.size === 0) {
      if (this.isShowing) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, width, height);
        this.isShowing = false;
      }
      return;
    }
    const layer = this.layerOf(width, height);
    const pieces = [...this.strokes.values()].flat();
    const palette = { mode: this.palette.themeName, tokens: this.palette.board?.tokens?.() };
    drawLiveInk(context, layer, pieces, camera, { width, height, dpr: camera.dpr }, palette);
    this.isShowing = true;
    this.report(this.engine.liveInk);
  }

  /**
   * Tells the channel the input just painted, once: a redraw for the camera shows nothing new.
   *
   * @param channel - The engine's live ink channel.
   */
  private report(channel: LiveInkChannel | undefined): void {
    const input = this.unpainted.current;
    if (input === undefined || channel === undefined) return;
    this.unpainted.current = undefined;
    channel.painted({ ...input, paintedMs: performance.now() });
  }

  /**
   * Sizes the canvas as the engine's own: its camera's viewport at its pixel ratio.
   *
   * @returns The camera, and the canvas's size in device px.
   */
  private fit(): { readonly camera: Camera; readonly width: number; readonly height: number } {
    const camera = this.camera?.read() ?? this.engine.camera();
    const width = Math.round(camera.viewportWidthPx * camera.dpr);
    const height = Math.round(camera.viewportHeightPx * camera.dpr);
    sizeCanvas(this.canvas, width, height);
    return { camera, width, height };
  }

  private layerOf(width: number, height: number): InkLayer | undefined {
    if (this.layer === undefined) {
      const canvas = this.canvas.ownerDocument.createElement('canvas');
      const context = canvas.getContext('2d');
      if (context !== null) this.layer = { canvas, context };
    }
    if (this.layer !== undefined) sizeCanvas(this.layer.canvas, width, height);
    return this.layer;
  }
}

/**
 * The live ink overlay: the stroke under way, drawn by the page on its own animation
 * frame over the engine's canvas, so the ink follows the pen whatever the engine's frames do
 * (on an iPad the engine's worker drew the live stroke only every third or fourth display
 * frame). It listens to the engine's live ink channel from its mount, if the page can give it a
 * 2D context, which makes the draw tool draw through it and preview the stroke in the engine at
 * opacity 0 (and stops listening if its own canvas then gives none); a written stroke stays until the engine shows it (`LiveInkChannel`'s hand-off), and
 * a dropped one clears at once. Its canvas is mounted at the first stroke and kept: until then
 * the board has only the engine's canvas.
 *
 * @param props - The engine, the camera and the theme.
 * @returns The overlay's canvas, once there was ink to show.
 */
export function LiveInkOverlay(props: LiveInkOverlayProps): ReactElement | null {
  const { engine, camera, themeName = 'light', board } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<InkStrokes>(new Map());
  const unpainted = useRef<UnpaintedSlot['current']>(undefined);
  const painter = useRef<LiveInkPainter | undefined>(undefined);
  const detach = useRef<(() => void) | undefined>(undefined);
  const [hasInk, setHasInk] = useState(false);
  const [canDraw, setCanDraw] = useState(true);
  useEffect(() => {
    if (!canDraw || !canDrawInk(document)) return undefined;
    const stop = engine?.liveInk?.attach((model) => {
      takeInk(strokes.current, model);
      if (model.phase === 'drawing' && model.inputMs !== undefined) {
        unpainted.current = { strokeId: model.strokeId, inputMs: model.inputMs };
      }
      painter.current?.schedule();
      if (model.phase === 'drawing') setHasInk(true);
    });
    detach.current = stop;
    return () => {
      detach.current = undefined;
      stop?.();
    };
  }, [engine, canDraw]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (engine === undefined || canvas === null) return undefined;
    if (canvas.getContext('2d') === null) {
      // The overlay's own canvas cannot draw: stop listening at once, so the draw tool shows the
      // stroke under way through the engine again, from its next move.
      detach.current?.();
      setCanDraw(false);
      return undefined;
    }
    const current = new LiveInkPainter(canvas, strokes.current, unpainted, engine, camera, {
      themeName,
      board,
    });
    painter.current = current;
    return () => {
      painter.current = undefined;
      current.destroy();
    };
  }, [hasInk, engine, camera, themeName, board]);
  if (!hasInk) return null;
  // It never takes a pointer: set on the element, where a test reads it.
  return (
    <canvas
      ref={canvasRef}
      className={styles.overlay}
      style={{ pointerEvents: 'none' }}
      data-live-ink=""
      aria-hidden="true"
    />
  );
}
