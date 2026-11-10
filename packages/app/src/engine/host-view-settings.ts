import type { DocumentStore } from '@canvas/document';
import { NO_STICKY_AUTHORS, type EngineHost, type StickyAuthors } from '@canvas/engine';
import type { CreationInkSource, ToolId } from '@canvas/tools';

import { ImageAverageColors } from '../assets/image-average-colors.js';
import type { WhiteboardChrome } from '../shell/whiteboard-chrome.js';
import { DEFAULT_VIEW_PREFERENCES, type ViewPreferences } from '../state/view-preferences.js';
import {
  canvasBackgroundOf,
  inkColorsOfThemes,
  overlayPaletteOf,
} from '../theme/canvas-background.js';
import type { ThemeName } from '../theme/theme-tokens.js';

import type { EngineDocument } from './engine-document.js';
import type { EngineHostMountOptions } from './engine-host-mount-options.js';
import type { HostView } from './host-view.js';
import type { MountEngineOptions } from './mounted-engine.js';

/** The tools whose new strokes or text take their default colour from what lies under them. */
const INKED_TOOLS: ReadonlySet<ToolId> = new Set([
  'shape',
  'line',
  'connector',
  'pen',
  'draw',
  'text',
]);

/**
 * What the engine host mount keeps of the view to give a host when it starts and on each
 * change: whether the dot grid shows, and the viewer's theme, which objects' `ink` draws in
 * (with the themes' `--color-ink` tokens) and which new strokes' and text's default
 * colour contrasts with (`creationInk`). Main thread.
 */
export class HostViewSettings {
  /** Whether the dot grid shows. */
  private isGridVisible: boolean;
  /** The viewer's theme. */
  private theme: ThemeName;
  /** The shell's chrome, which the overlay's palette follows. */
  private chrome: WhiteboardChrome;
  /** Who wrote each sticky, as the board shows it; none until the shell sends them. */
  private stickyAuthors: StickyAuthors = NO_STICKY_AUTHORS;
  /**
   * The viewer's theme and canvas and the images' average colours, for the creation tools'
   * default colour.
   */
  readonly creationInk: CreationInkSource;
  /** The page's images' average colours, when the page has images. */
  private readonly averageColors: ImageAverageColors | undefined;
  /** The creation tools whose `ink` the person picked (`setInkPicked`). */
  private readonly pickedInk = new Set<ToolId>();
  /**
   * Called after the theme or the chrome changed: the overlay is shown again
   * in its colours.
   */
  private readonly onThemeChange: (() => void) | undefined;

  /**
   * Starts from the mount's options: a preview's grid, else the person's, else the default.
   *
   * @param options - The mount's options.
   * @param hostOptions - The host mount's options.
   * @param onThemeChange - Called after the theme changed; nothing if absent.
   */
  constructor(
    options: MountEngineOptions,
    hostOptions: EngineHostMountOptions,
    onThemeChange?: () => void,
  ) {
    this.onThemeChange = onThemeChange;
    this.theme = options.initialTheme ?? 'light';
    this.chrome = options.whiteboardChrome ?? 'classic';
    const { images } = options;
    this.averageColors =
      images && new ImageAverageColors({ readRecord: images.availability.readRecord });
    const averageColorOf = this.averageColors?.averageColorOf;
    this.creationInk = {
      theme: () => this.theme,
      canvasColor: canvasBackgroundOf,
      isInkPicked: (tool) => this.pickedInk.has(tool),
      overlayPalette: () => overlayPaletteOf(this.theme, this.chrome),
      ...(averageColorOf === undefined ? {} : { averageColorOf }),
    };
    this.isGridVisible =
      hostOptions.previewScene?.isGridVisible ??
      options.initialViewPreferences?.isGridVisible ??
      DEFAULT_VIEW_PREFERENCES.isGridVisible;
  }

  /**
   * Gives a host that just started the grid and the theme.
   *
   * @param host - The host.
   */
  show(host: EngineHost): void {
    host.setGridVisible(this.isGridVisible);
    host.setTheme(this.theme, inkColorsOfThemes());
    if (this.stickyAuthors !== NO_STICKY_AUTHORS) host.setStickyAuthors(this.stickyAuthors);
  }

  /**
   * Reads ahead the average colours of the board's images when a tool whose new strokes or text
   * contrast with what is under them is chosen, so the press finds them known.
   *
   * @param tool - The tool chosen.
   * @param store - The board.
   */
  toolChosen(tool: ToolId, store: DocumentStore): void {
    if (this.averageColors === undefined || !INKED_TOOLS.has(tool)) return;
    const assetIds: string[] = [];
    for (const object of store.read().objects.values()) {
      if (object.type === 'image') assetIds.push(object.assetId);
    }
    this.averageColors.warm(assetIds);
  }

  /**
   * Applies the person's view preferences: the grid, snapping, and what deleting an object does
   * to the connectors attached to it.
   *
   * @param preferences - The preferences.
   * @param host - The host, if it runs.
   * @param document - The engine's document side.
   */
  setViewPreferences(
    preferences: ViewPreferences,
    host: EngineHost | undefined,
    document: Pick<EngineDocument, 'setSnapping' | 'selectTool'>,
  ): void {
    const { isGridVisible, isSnappingOn, shouldDeleteConnectors } = preferences;
    this.setGridVisible(isGridVisible, host);
    document.setSnapping({ isEnabled: isSnappingOn, isGridVisible });
    document.selectTool.connectorPolicy = shouldDeleteConnectors ? 'delete' : 'detach';
  }

  /**
   * Shows or hides the dot grid, and tells the host when it runs.
   *
   * @param isVisible - Whether the grid shows.
   * @param host - The host, once it runs.
   */
  setGridVisible(isVisible: boolean, host: EngineHost | undefined): void {
    this.isGridVisible = isVisible;
    host?.setGridVisible(isVisible);
  }

  /**
   * Records whether the person picked a creation tool's `ink`, which
   * `creationInk.isInkPicked` reads when the tool creates.
   *
   * @param tool - The creation tool.
   * @param isPicked - Whether its `ink` was picked.
   */
  setInkPicked(tool: ToolId, isPicked: boolean): void {
    if (isPicked) this.pickedInk.add(tool);
    else this.pickedInk.delete(tool);
  }

  /**
   * A `MountedEngine.setTheme` for a mount: {@link setTheme} with the mount's host at the time.
   *
   * @param host - The mount's host, once it runs.
   * @returns The setter.
   */
  themeSetter(host: () => EngineHost | undefined): (theme: ThemeName) => void {
    return (theme) => {
      this.setTheme(theme, host());
    };
  }

  /**
   * Changes the theme, and tells the host when it runs and the theme changed, and then whoever
   * shows the overlay in the theme's colours (`onThemeChange`).
   *
   * @param theme - The theme shown now.
   * @param host - The host, once it runs.
   */
  setTheme(theme: ThemeName, host: EngineHost | undefined): void {
    if (theme === this.theme) return;
    this.theme = theme;
    host?.setTheme(theme, inkColorsOfThemes());
    this.onThemeChange?.();
  }

  /**
   * Whether the chrome has the design tools: every chrome but the floating one, a
   * whiteboard's, which has no components.
   *
   * @returns False under the floating chrome.
   */
  get hasDesignTools(): boolean {
    return this.chrome !== 'floating';
  }

  /**
   * Changes the shell's chrome (`MountedEngine.setWhiteboardChrome`), and then has the
   * overlay shown again in its palette (`onThemeChange`) when it changed.
   *
   * @param chrome - The chrome shown now.
   */
  setWhiteboardChrome(chrome: WhiteboardChrome): void {
    if (chrome === this.chrome) return;
    this.chrome = chrome;
    this.onThemeChange?.();
  }

  /**
   * A `MountedEngine.setStickyAuthors` for a mount: keeps the authors, so a host the
   * mount shows later starts with them (`show`), and sends them through the mount's view now.
   *
   * @param view - The mount's view, once a host runs.
   * @returns The setter.
   */
  stickyAuthorsSetter(view: () => HostView | undefined): (authors: StickyAuthors) => void {
    return (authors) => {
      this.stickyAuthors = authors;
      view()?.setStickyAuthors(authors);
    };
  }
}
