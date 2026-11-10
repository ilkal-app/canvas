import type { BoardSnapshot } from '@canvas/document';
import { fitsCapture, type ColorTokenValues, type EnginePixels } from '@canvas/engine';
import type { Rgba } from '@canvas/schema';

import type { PageImages } from '../assets/page-images.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { canvasBackgroundOf } from '../theme/canvas-background.js';
import type { ThemeName } from '../theme/theme-tokens.js';

import { captureExport, type CaptureExportOptions } from './capture-export.js';
import { exportFileName } from './export-file-name.js';
import { exportScopeOf, type ExportRequest, type ExportScope } from './export-scope.js';

/**
 * Where an export goes and what it is drawn with besides the board: the images, the file's name,
 * the theme and the notice (home's card menu).
 */
export interface ExportOutput {
  /** The page's images; none without the assets service. */
  readonly images: PageImages | undefined;
  /** The board's name, which the file is named after. */
  readonly title: string;
  /** The viewer's theme: what `ink` draws in, and the backdrop under the board. */
  readonly themeName: ThemeName;
  /**
   * Tells the person why an export did not happen.
   *
   * @param message - The sentence.
   */
  readonly notify: (message: string) => void;
}

/** What the shell gives the board menu's Export. */
export interface BoardExporter extends ExportOutput {
  /** The mounted engine: its board, selection and page shown; none before mount. */
  readonly engine: MountedEngine | undefined;
}

/** What an export does besides drawing, injected in tests. */
export interface ExportDependencies {
  /** Draws the scope (`captureExport`). */
  readonly capture?: typeof captureExport;
  /**
   * Encodes the image as a PNG over the backdrop (`encodePng`).
   *
   * @param pixels - The image, premultiplied.
   * @param backdrop - The colour under it.
   * @returns The file's bytes.
   */
  readonly encode?: (pixels: EnginePixels, backdrop: Rgba) => Promise<Blob>;
  /**
   * Hands the file to the person (`downloadFile`).
   *
   * @param file - The bytes.
   * @param name - The file's name.
   */
  readonly save?: (file: Blob, name: string) => void;
}

/** What the person is told when the export would be too large even at 1×. */
export const EXPORT_TOO_LARGE_MESSAGE =
  'This is too large to export as one image (at most 16,384 px a side). Select part of it.';

/** What the person is told when there is nothing to export. */
export const EXPORT_EMPTY_MESSAGE = 'There is nothing to export on this page.';

/** What the person is told when an export was saved before every image had loaded. */
export const EXPORT_INCOMPLETE_MESSAGE =
  'Exported, but some images had not loaded and may be missing or blurry.';

/** What the person is told when an export failed. */
export const EXPORT_FAILED_MESSAGE = 'The export could not be made. Try again.';

/**
 * What the board menu's Export exports now: the selection when something is selected, else the
 * page shown.
 *
 * @param engine - The mounted engine.
 * @returns The request, or undefined before mount.
 */
export function exportRequestOf(engine: MountedEngine | undefined): ExportRequest | undefined {
  if (engine === undefined) return undefined;
  const { selectedIds } = engine.board.state();
  if (selectedIds.length > 0) return { kind: 'selection', ids: selectedIds };
  const pageId = engine.pages?.current();
  return pageId === undefined ? undefined : { kind: 'page', pageId };
}

/**
 * The whole board across pages, as the engine's view reads it.
 *
 * @param engine - The mounted engine.
 * @returns The board, or undefined where the view has no whole board apart.
 */
function wholeBoardOf(engine: MountedEngine): BoardSnapshot | undefined {
  const reader = (engine.board.definitions ?? engine.board.board) as {
    readonly read?: () => BoardSnapshot;
  };
  return reader.read?.();
}

/** What an export draws, read as it starts. */
export interface ResolvedExport {
  /** The whole board. */
  readonly board: BoardSnapshot;
  /** What it draws (`exportScopeOf`). */
  readonly scope: ExportScope;
  /** The board's colour tokens; the built-ins' defaults if absent. */
  readonly tokens: ColorTokenValues | undefined;
}

/**
 * What the board menu's Export draws now: the selection, else the page shown
 * (`exportRequestOf`), on the whole board.
 *
 * @param exporter - The shell's exporter.
 * @returns The board, scope and tokens, or undefined when there is nothing to export.
 */
export function resolveExport(exporter: BoardExporter): ResolvedExport | undefined {
  const { engine } = exporter;
  const request = exportRequestOf(engine);
  const board = engine === undefined ? undefined : wholeBoardOf(engine);
  if (engine === undefined || request === undefined || board === undefined) return undefined;
  const scope = exportScopeOf(board, request);
  return scope === undefined ? undefined : { board, scope, tokens: engine.board.tokens?.() };
}

/**
 * The image composed over an opaque backdrop: what the canvas shows, its colour under the board.
 * Pure.
 *
 * @param pixels - The image, RGBA8 premultiplied.
 * @param backdrop - The backdrop, straight alpha, channels 0 to 1.
 * @returns Opaque RGBA8 bytes, rows top to bottom.
 */
export function overBackdrop(pixels: EnginePixels, backdrop: Rgba): Uint8ClampedArray<ArrayBuffer> {
  const { rgba } = pixels;
  const source = new DataView(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const out = new Uint8ClampedArray(rgba.length);
  const [red, green, blue] = backdrop;
  for (let index = 0; index < rgba.length; index += 4) {
    const cover = 255 - source.getUint8(index + 3);
    out[index] = source.getUint8(index) + red * cover;
    out[index + 1] = source.getUint8(index + 1) + green * cover;
    out[index + 2] = source.getUint8(index + 2) + blue * cover;
    out[index + 3] = 255;
  }
  return out;
}

/**
 * Encodes an image as a PNG over a backdrop, on a detached canvas.
 *
 * @param pixels - The image, premultiplied.
 * @param backdrop - The colour under it.
 * @returns The PNG's bytes.
 * @throws {Error} When the browser cannot encode it.
 */
export async function encodePng(pixels: EnginePixels, backdrop: Rgba): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = pixels.widthPx;
  canvas.height = pixels.heightPx;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('No 2D canvas to encode the export with.');
  context.putImageData(
    new ImageData(overBackdrop(pixels, backdrop), pixels.widthPx, pixels.heightPx),
    0,
    0,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('The browser could not encode the export as a PNG.'));
      else resolve(blob);
    }, 'image/png');
  });
}

/**
 * Hands a file to the person: a download under its name.
 *
 * @param file - The bytes.
 * @param name - The file's name.
 */
export function downloadFile(file: Blob, name: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // After the click has handed the address to the download.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * The scale an export is drawn at: the one asked for, else 1× when that is too large.
 *
 * @param scope - The export.
 * @param scale - The scale asked for.
 * @returns The scale, or undefined when even 1× is too large.
 */
function fittingScale(scope: ExportScope, scale: number): number | undefined {
  if (fitsCapture(scope.rect, scale)) return scale;
  return scale !== 1 && fitsCapture(scope.rect, 1) ? 1 : undefined;
}

/**
 * Exports the selection, or the page shown, as a PNG: `exportScopePng` of what the
 * board menu's Export draws now (`resolveExport`).
 *
 * @param exporter - The shell's board, images, title, theme and notice.
 * @param scale - Device px per board unit.
 * @param dependencies - Replacements for the capture, the encoding and the download, in tests.
 * @returns Settles once the file is handed over, or the person told why not.
 */
export async function exportBoardPng(
  exporter: BoardExporter,
  scale: 1 | 2,
  dependencies: ExportDependencies = {},
): Promise<void> {
  await exportScopePng(resolveExport(exporter), exporter, scale, dependencies);
}

/**
 * Exports a scope as a PNG (home's card menu): drawn by an engine of its own
 * (`captureExport`) at the scale (1× when the scale asked for is over the capture limits),
 * composed over the theme's canvas colour and downloaded as `exportFileName`. The person is told
 * when there is nothing to export, when it is too large, when an image had not loaded in time
 * (it is saved all the same), or when it failed.
 *
 * @param resolved - What it draws; undefined when there is nothing to export.
 * @param output - The images, title, theme and notice.
 * @param scale - Device px per board unit.
 * @param dependencies - Replacements for the capture, the encoding and the download, in tests.
 * @returns Settles once the file is handed over, or the person told why not.
 */
export async function exportScopePng(
  resolved: ResolvedExport | undefined,
  output: ExportOutput,
  scale: 1 | 2,
  dependencies: ExportDependencies = {},
): Promise<void> {
  if (resolved === undefined) {
    output.notify(EXPORT_EMPTY_MESSAGE);
    return;
  }
  const { scope } = resolved;
  const fitted = fittingScale(scope, scale);
  if (fitted === undefined) {
    output.notify(EXPORT_TOO_LARGE_MESSAGE);
    return;
  }
  const options: CaptureExportOptions = {
    scale: fitted,
    themeName: output.themeName,
    tokens: resolved.tokens,
    images: output.images,
  };
  try {
    const pixels = await (dependencies.capture ?? captureExport)(scope, options);
    const backdrop = canvasBackgroundOf(output.themeName);
    const file = await (dependencies.encode ?? encodePng)(pixels, backdrop);
    (dependencies.save ?? downloadFile)(
      file,
      exportFileName(output.title, scope.kind, 'png', fitted),
    );
    if (!pixels.isComplete) output.notify(EXPORT_INCOMPLETE_MESSAGE);
  } catch {
    output.notify(EXPORT_FAILED_MESSAGE);
  }
}
