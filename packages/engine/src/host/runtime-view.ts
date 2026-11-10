import type { InkTheme } from '@canvas/schema';

import type { ColorTokenValues, InkColors } from '../paint/color-palette.js';
import { isFrameFillFallback, type ColorModeFallbackName } from '../scene/color-mode-fallback.js';
import { NO_STICKY_AUTHORS, type StickyAuthors } from '../text/scene/sticky-author-box.js';

import type { EngineHostOptions } from './engine-host.js';

/**
 * The viewer's theme as an engine assembly is built with it: the theme
 * that resolves `'ink'` and colour tokens in no explicit mode, what ink draws as per theme when
 * the host gave it, and the board's colour token values when the host sent them. Plain data.
 */
export interface RuntimeInk {
  /** The viewer's theme. */
  readonly theme: InkTheme;
  /** What ink draws as per theme; absent, the schema's `INK_COLORS`. */
  readonly inkColors?: InkColors;
  /** The board's colour token values (`EngineHost.setColorTokens`); absent, none. */
  readonly colorTokens?: ColorTokenValues;
  /** The built-in colour mode fallback the host chose; absent, none. */
  readonly colorModeFallback?: ColorModeFallbackName;
}

/** What the view settings apply to: the current assembly's grid and renderer. */
interface ViewTarget {
  /** The dot grid. */
  readonly grid: { setVisible(isVisible: boolean): void };
  /** The renderer. */
  readonly renderer: {
    setTheme(theme: InkTheme, inkColors?: InkColors): number;
    setColorTokens(table: ColorTokenValues): number;
    setStickyAuthors(authors: StickyAuthors): number;
  };
}

/**
 * The engine runtime's per-viewer view settings, never part of the document: whether the dot
 * grid shows and the theme that resolves ink. Kept across device losses, so a rebuilt assembly
 * starts with them, and applied to the current assembly as they change. On the thread that
 * renders.
 */
export class RuntimeView {
  private isGridVisible = false;
  private ink: RuntimeInk;
  private stickyAuthors: StickyAuthors = NO_STICKY_AUTHORS;

  /**
   * Starts with the host's initial theme and the grid hidden.
   *
   * @param options - The host's options: `theme`, `inkColors` and `colorModeFallback`.
   * @param target - The current assembly, or undefined once the runtime is destroyed.
   * @param requestFrame - Asks the runtime for a frame.
   */
  constructor(
    options: EngineHostOptions,
    private readonly target: () => ViewTarget | undefined,
    private readonly requestFrame: () => void,
  ) {
    this.ink = {
      theme: options.theme ?? 'light',
      ...(options.inkColors && { inkColors: options.inkColors }),
      ...(isFrameFillFallback(options.colorModeFallback) && {
        colorModeFallback: options.colorModeFallback,
      }),
    };
  }

  /**
   * What a new assembly is built with.
   *
   * @returns Whether the grid shows, the theme and the sticky authors.
   */
  get setup(): {
    readonly isGridVisible: boolean;
    readonly ink: RuntimeInk;
    readonly stickyAuthors: StickyAuthors;
  } {
    return { isGridVisible: this.isGridVisible, ink: this.ink, stickyAuthors: this.stickyAuthors };
  }

  /**
   * Shows or hides the dot grid of the current assembly, asking for a frame when it changed.
   *
   * @param isVisible - Whether the grid shows.
   */
  setGridVisible(isVisible: boolean): void {
    const assembly = this.target();
    if (assembly === undefined || this.isGridVisible === isVisible) return;
    this.isGridVisible = isVisible;
    assembly.grid.setVisible(isVisible);
    this.requestFrame();
  }

  /**
   * Switches the theme, rewriting the current renderer's ink and token records
   * (`SceneRenderer.setTheme`), and asks for a frame.
   *
   * @param theme - The viewer's theme.
   * @param inkColors - What ink draws as per theme; default the current ones.
   */
  setTheme(theme: InkTheme, inkColors = this.ink.inkColors): void {
    const assembly = this.target();
    if (assembly !== undefined) {
      this.ink = { ...this.ink, theme, ...(inkColors && { inkColors }) };
      assembly.renderer.setTheme(theme, inkColors);
    }
    this.requestFrame();
  }

  /**
   * Replaces the board's colour token values, rewriting the current renderer's records
   * that name a changed token (`SceneRenderer.setColorTokens`), kept for a rebuilt assembly; asks
   * for a frame.
   *
   * @param colorTokens - The values.
   */
  setColorTokens(colorTokens: ColorTokenValues): void {
    const assembly = this.target();
    if (assembly !== undefined) {
      this.ink = { ...this.ink, colorTokens };
      assembly.renderer.setColorTokens(colorTokens);
    }
    this.requestFrame();
  }

  /**
   * Replaces who wrote each sticky: the current renderer lays out just the labels that
   * change (`SceneRenderer.setStickyAuthors`), and a rebuilt assembly starts with them; asks for
   * a frame.
   *
   * @param authors - The board's sticky authors.
   */
  setStickyAuthors(authors: StickyAuthors): void {
    this.stickyAuthors = authors;
    this.target()?.renderer.setStickyAuthors(authors);
    this.requestFrame();
  }
}
