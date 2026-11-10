import {
  captureScene,
  planCapture,
  serializeChangeSet,
  type CaptureRect,
  type CaptureTile,
  type ColorTokenValues,
  type EngineFrameReport,
  type EngineHost,
  type EnginePixels,
} from '@canvas/engine';
import { fontFamilyUsesOf } from '@canvas/schema';

import type { PageImages } from '../assets/page-images.js';
import { expandPreviewScene } from '../collab/instance-projection.js';
import { attachedImageHostOptions } from '../engine/image-host-options.js';
import { offscreenHostPlatform, startBrowserHost } from '../engine/start-browser-host.js';
import { ensurePageFont, loadPageFonts } from '../text-input/page-fonts.js';
import { inkColorsOfThemes } from '../theme/canvas-background.js';
import type { ThemeName } from '../theme/theme-tokens.js';

import type { ExportScope } from './export-scope.js';

/**
 * The most reads a tile waits through for its glyphs and images: frames, not time, so a frozen
 * scenario clock cannot hold it forever. Each read is a frame with the jobs and fetches between.
 */
const MAX_TILE_READS = 600;

/** What a capture draws with besides the scope. */
export interface CaptureExportOptions {
  /** Device px per board unit. */
  readonly scale: number;
  /** The viewer's theme, which `ink` draws in. */
  readonly themeName: ThemeName;
  /** The board's colour tokens; the built-ins' defaults if absent. */
  readonly tokens?: ColorTokenValues | undefined;
  /** The page's images; the fallback (placeholders, or the harness's) if absent. */
  readonly images?: PageImages | undefined;
  /**
   * Starts the capture's engine host on a canvas; a main-thread host with the page's fonts and
   * an attached image link (`attachedImageHostOptions`) if absent.
   */
  readonly startHost?: ((canvas: HTMLCanvasElement) => Promise<EngineHost>) | undefined;
}

/** What a capture of several areas draws with (`captureExportAreas`). */
export interface CaptureAreasOptions extends CaptureExportOptions {
  /**
   * Takes each image as it is drawn, awaited before the next is drawn, so no image is kept past
   * it (a PDF's pages); the images are returned if absent.
   *
   * @param image - The area's image.
   * @param index - The area's place among the areas.
   * @returns Settles once it is taken.
   */
  readonly onImage?: ((image: CapturedExport, index: number) => Promise<void>) | undefined;
}

/**
 * Whether two cameras draw the same window.
 *
 * @param a - One camera, from a frame report.
 * @param b - The tile's.
 * @returns True when they match.
 */
function isTileCamera(a: EngineFrameReport['camera'], b: CaptureTile['camera']): boolean {
  return (
    a?.x === b.x &&
    a.y === b.y &&
    a.zoom === b.zoom &&
    a.viewportWidthPx === b.viewportWidthPx &&
    a.viewportHeightPx === b.viewportHeightPx
  );
}

/** An export's image, and whether every tile settled before it was read. */
export interface CapturedExport extends EnginePixels {
  /**
   * Whether every tile was read once it showed everything: no work left, no image a placeholder
   * or blank, no image level loading. False when a tile ran out of reads first (an image that
   * never loads, say): its pixels are what it drew then.
   */
  readonly isComplete: boolean;
}

/**
 * Whether a frame of a tile shows everything: drawn with the tile's camera, no
 * work left for a later frame, no image drawn as a placeholder or blank, and no image level
 * being fetched, decoded or uploaded.
 *
 * @param report - The frame's report.
 * @param tile - The tile.
 * @returns True when it does.
 */
function isSettledFrame(report: EngineFrameReport | undefined, tile: CaptureTile): boolean {
  return (
    report !== undefined &&
    isTileCamera(report.camera, tile.camera) &&
    !report.hasPendingWork &&
    report.stats.placeholderImages === 0 &&
    report.stats.blankImages === 0 &&
    report.isImageIdle !== false
  );
}

/**
 * Reads a tile once the host has drawn it showing everything (`isSettledFrame`: every glyph and
 * image it waits for arrived, at the level it wants), or after {@link MAX_TILE_READS} reads: what
 * it drew then.
 *
 * @param host - The host, its camera already on the tile.
 * @param tile - The tile.
 * @returns The tile's pixels, and whether it had settled.
 */
async function readSettledTile(
  host: EngineHost,
  tile: CaptureTile,
): Promise<{ readonly pixels: EnginePixels; readonly isSettled: boolean }> {
  let last: EngineFrameReport | undefined;
  const stop = host.onFrame((report) => {
    last = report;
  });
  const rect = { xPx: 0, yPx: 0, widthPx: tile.widthPx, heightPx: tile.heightPx };
  try {
    for (let reads = 1; ; reads += 1) {
      const pixels = await host.readPixels(rect);
      const isSettled = isSettledFrame(last, tile);
      if (isSettled || reads >= MAX_TILE_READS) return { pixels, isSettled };
      host.requestFrame();
    }
  } finally {
    stop();
  }
}

/**
 * Loads every font family the objects name, so their text draws in its own faces, the page's
 * fonts started first where nothing has started them.
 *
 * @param scope - The export.
 * @returns Settles once each has loaded or failed.
 */
async function ensureFonts(scope: ExportScope): Promise<void> {
  // A page that has not drawn a board yet (home's Export) has not started its fonts, and
  // `ensurePageFont` waits for them: start them here.
  loadPageFonts();
  const families = new Set(
    scope.objects.flatMap((object) => fontFamilyUsesOf(object).map(({ family }) => family)),
  );
  await Promise.all([...families].map((family) => ensurePageFont(family).catch(() => false)));
}

/**
 * Draws an export: the scope's shown objects at the scale, tile by tile
 * (`planCapture`, `captureScene`), with an engine of its own on a detached canvas, on WebGL2, as
 * the canvas draws them: the page's fonts (every family the objects name loaded first), the
 * page's images over an attached link at the level the scale needs, the viewer's theme and the
 * board's colour tokens, no dot grid, a transparent clear. Each tile is read once it has settled.
 *
 * @param scope - What to draw (`exportScopeOf`).
 * @param options - The scale, theme, tokens and images.
 * @returns The image (RGBA8, premultiplied, rows top to bottom) and whether every tile settled.
 * @throws {RangeError} When the image is over the capture limits (`planCapture`).
 */
export async function captureExport(
  scope: ExportScope,
  options: CaptureExportOptions,
): Promise<CapturedExport> {
  const [captured] = await captureExportAreas(scope, [scope.rect], options);
  if (captured === undefined) throw new Error('The export drew no image.');
  return captured;
}

/**
 * Draws areas of an export (a PDF's pages), each as `captureExport` draws the scope's
 * rect, with one engine host for them all: the scope's objects are sent once and each area is a
 * camera window of its own.
 *
 * @param scope - What draws (`exportScopeOf`).
 * @param rects - The areas, board units.
 * @param options - The scale, theme, tokens and images, and what takes each image as drawn.
 * @returns One image per area, in order, each with whether its tiles settled; none when
 *   `options.onImage` took them.
 * @throws {RangeError} When an area is over the capture limits (`planCapture`).
 */
export async function captureExportAreas(
  scope: ExportScope,
  rects: readonly CaptureRect[],
  options: CaptureAreasOptions,
): Promise<CapturedExport[]> {
  const { onImage } = options;
  const plans = rects.map((rect) => planCapture(rect, options.scale));
  const start =
    options.startHost ??
    ((canvas: HTMLCanvasElement) =>
      startBrowserHost(canvas, 'main', {
        // WebGL2, the WebGPU backend's parity peer (golden parity) and what the render service
        // draws with: no WebGPU adapter is asked for, which a machine without one warns about.
        backend: 'webgl2',
        imageOptions: attachedImageHostOptions(options.images),
        platform: offscreenHostPlatform(),
      }));
  await ensureFonts(scope);
  const host = await start(document.createElement('canvas'));
  try {
    host.setGridVisible(false);
    host.setTheme(options.themeName, inkColorsOfThemes());
    if (options.tokens !== undefined) host.setColorTokens(options.tokens);
    host.applyChangeSet(serializeChangeSet(expandPreviewScene(scope.objects, scope.shownIds)));
    const captured: CapturedExport[] = [];
    for (const [index, plan] of plans.entries()) {
      let isComplete = true;
      const pixels = await captureScene(plan, async (tile) => {
        host.resize(tile.widthPx, tile.heightPx, 1);
        host.setCamera(tile.camera);
        const read = await readSettledTile(host, tile);
        isComplete &&= read.isSettled;
        return read.pixels.rgba;
      });
      if (onImage === undefined) captured.push({ ...pixels, isComplete });
      else await onImage({ ...pixels, isComplete }, index);
    }
    return captured;
  } finally {
    host.destroy();
  }
}
