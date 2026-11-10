import type { Camera } from '@canvas/engine';
import type { BoardObject } from '@canvas/schema';

import type { CanvasBackingSize } from '../canvas/backing-store-size.js';
import type { BoardConnectionStatus } from '../collab/board-connection-status.js';
import type { EngineInspection } from '../engine/engine-document.js';
import type { SelectionContext } from '../panels/panel-sections.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';
import type { ThemePreference } from '../theme/theme-preference.js';
import type { ThemeName } from '../theme/theme-tokens.js';

/**
 * The attribute that marks the shell's root element when the test harness is on, so a scenario
 * test finds the harness with `[data-canvas-harness]`.
 */
export type CanvasHarnessAttribute = 'data-canvas-harness';

/** The property of the marked root element that holds its {@link CanvasHarness}. */
export type CanvasHarnessProperty = 'canvasHarness';

/**
 * The shell's root element as the harness leaves it: it carries the
 * {@link CanvasHarnessAttribute} attribute and its harness in the
 * {@link CanvasHarnessProperty} property.
 */
export type CanvasHarnessHost = HTMLElement & Partial<Record<CanvasHarnessProperty, CanvasHarness>>;

/** A rectangle of the canvas's drawing buffer, in device pixels from its top-left corner. */
export interface PixelRect {
  /** Left edge, device px; a whole number, at least 0. */
  readonly xPx: number;
  /** Top edge, device px; a whole number, at least 0. */
  readonly yPx: number;
  /** Width, device px; a whole number, at least 1. */
  readonly widthPx: number;
  /** Height, device px; a whole number, at least 1. */
  readonly heightPx: number;
}

/** Pixels read from the canvas: RGBA8, not premultiplied, row by row from the top-left. */
export interface PixelBlock {
  /** Width, device px. */
  readonly widthPx: number;
  /** Height, device px. */
  readonly heightPx: number;
  /** `widthPx × heightPx × 4` bytes: red, green, blue and alpha of each pixel. */
  readonly rgba: Uint8ClampedArray;
}

/**
 * The canvas as measured now: its CSS box, its drawing buffer and the device pixel ratio, plus
 * where it sits in the viewport so a test can aim pointer input at it.
 */
export interface CanvasMetrics extends CanvasBackingSize {
  /** Left edge in the viewport, CSS px. */
  readonly cssLeftPx: number;
  /** Top edge in the viewport, CSS px. */
  readonly cssTopPx: number;
}

/** The theme in effect and the person's choice behind it. */
export interface HarnessTheme {
  /** The theme shown now. */
  readonly name: ThemeName;
  /** The person's choice, which may be `system`. */
  readonly preference: ThemePreference;
}

/** What the shell's panels show, for scenario tests. */
export interface HarnessPanels {
  /** The style panel's context: the selection's, or the active creation tool's. */
  readonly styleContext: SelectionContext;
  /** The ids of the style panel sections showing, in order. */
  readonly styleSectionIds: readonly string[];
}

/**
 * What the harness reports, as plain data that survives structured cloning, so a Playwright
 * test can read it with one `evaluate`.
 */
export interface CanvasHarnessSnapshot {
  /** The shell reducer's state. */
  readonly shellState: ShellState;
  /**
   * The actions dispatched to the shell reducer, oldest first, from shortcuts, the toolbar and
   * dialogs alike; the last hundred are kept.
   */
  readonly dispatchedActions: readonly ShellAction[];
  /** The shortcut registry the shell matches key presses against. */
  readonly shortcutRegistry: ShortcutRegistry<ShellAction>;
  /** The theme. */
  readonly theme: HarnessTheme;
  /**
   * The canvas, measured when the snapshot is taken: its CSS box, and the drawing buffer and
   * ratio the engine last drew with, where it runs (the element's own size before its first
   * frame); undefined while none is mounted.
   */
  readonly canvas: CanvasMetrics | undefined;
  /**
   * The camera the canvas shows now (world top-left, zoom, viewport in CSS px, dpr), from the
   * engine; undefined while no engine is mounted.
   */
  readonly camera: Camera | undefined;
  /**
   * The selection (ids and the selected objects as stored) and the document's recent change
   * sets, one per transaction, from the engine; undefined while no engine is mounted.
   */
  readonly document: EngineInspection | undefined;
  /**
   * Where the shell's board stands with the relay (state, local-only, collaborators), when the
   * shell was given a board connection; undefined otherwise.
   */
  readonly connection: BoardConnectionStatus | undefined;
  /** What the panels show. */
  readonly panels: HarnessPanels;
}

/**
 * The typed test harness the app exposes when built or served with `VITE_CANVAS_HARNESS=1`,
 * replacing the prototype's `window.__wb`. It lives on the shell's root
 * element ({@link CanvasHarnessHost}), so each shell on a page has its own and nothing is
 * global. Production bundles do not contain it. Runs on the main thread.
 */
export interface CanvasHarness {
  /**
   * Reports the shell's state now.
   *
   * @returns The shell state, the dispatched actions, the shortcuts, the theme and the canvas.
   */
  snapshot(): CanvasHarnessSnapshot;
  /**
   * Reads what the canvas shows in a rectangle of its drawing buffer, from inside the engine
   * frame. The read is a capture request that the engine's next frame fulfils (the engine
   * host asks for one on its own animation frames, in the worker or on the main thread), and
   * that frame reads the canvas back after `submit`, in the same task that drew it, before the
   * browser presents and discards the drawing buffer. So the GPU canvas needs no
   * `preserveDrawingBuffer`, and the pixels are exactly the frame the current camera and board
   * produce. They are converted from the canvas's premultiplied alpha to straight alpha.
   *
   * @param rect - The rectangle, in device pixels, inside the drawing buffer.
   * @returns The pixels, once the frame has been read back.
   * @throws {RangeError} When the rectangle is not whole pixels inside the drawing buffer (as a
   *   rejection).
   * @throws {Error} When no canvas or engine is mounted, or the engine could not start (as a
   *   rejection).
   */
  readPixels(rect: PixelRect): Promise<PixelBlock>;
  /**
   * Reads one object of the shell's board as its document holds it now, remote edits included:
   * how a two-page scenario checks that a move made in one page arrived in the other.
   *
   * @param id - The object's id.
   * @returns The object, or undefined when the board has no such object or the shell was given
   *   no board connection.
   */
  readObject(id: string): BoardObject | undefined;
  /**
   * Reads every object of the shell's board as its document holds it now, remote edits included:
   * how a two-page scenario checks that both pages hold the same board.
   *
   * @returns The objects, in the document's order; empty when the shell was given no board
   *   connection.
   */
  readObjects(): BoardObject[];
  /**
   * Opens a stepped run on the shell's board and keeps it: until `endStoreRun`, the
   * board refuses other writers, as during a large command, so a scenario sees input held.
   *
   * @throws {Error} When the shell has no board, or the harness already holds a run.
   */
  beginStoreRun(): void;
  /**
   * Reports the held run's progress, as a large command does after each part.
   *
   * @param done - The parts committed.
   * @param total - All its parts.
   */
  reportStoreRunProgress(done: number, total: number): void;
  /** Ends the held run; nothing when none is held. */
  endStoreRun(): void;
}
