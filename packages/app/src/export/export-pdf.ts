import { fitsCapture, type CaptureRect, type EnginePixels } from '@canvas/engine';
import type { Rgba } from '@canvas/schema';

import { canvasBackgroundOf } from '../theme/canvas-background.js';

import { captureExportAreas, type CapturedExport } from './capture-export.js';
import { exportFileName } from './export-file-name.js';
import { exportSectionsOf } from './export-sections.js';
import { writePdf, type PdfImagePage } from './pdf-writer.js';
import {
  downloadFile,
  EXPORT_EMPTY_MESSAGE,
  EXPORT_FAILED_MESSAGE,
  EXPORT_INCOMPLETE_MESSAGE,
  EXPORT_TOO_LARGE_MESSAGE,
  overBackdrop,
  resolveExport,
  type BoardExporter,
  type ExportOutput,
  type ResolvedExport,
} from './run-export.js';

/** Points per board unit: a board unit is a CSS px, 1/96 in, and a point 1/72 in. */
const POINTS_PER_UNIT = 0.75;

/** The largest page side a PDF reader takes, pt (200 in). */
const MAX_PAGE_POINTS = 14_400;

/** The scale a page is drawn at where it fits: px per board unit. */
const PAGE_SCALE = 2;

/** What a PDF export does besides drawing, injected in tests. */
export interface PdfExportDependencies {
  /** Draws the pages (`captureExportAreas`). */
  readonly captureAreas?: typeof captureExportAreas;
  /**
   * Deflates a page's RGB bytes (`deflateBytes`).
   *
   * @param bytes - The bytes.
   * @returns The zlib stream.
   */
  readonly deflate?: (bytes: Uint8Array) => Promise<Uint8Array>;
  /**
   * Hands the file to the person (`downloadFile`).
   *
   * @param file - The bytes.
   * @param name - The file's name.
   */
  readonly save?: (file: Blob, name: string) => void;
}

/**
 * Deflates bytes as a zlib stream, as FlateDecode reads it, with the browser's
 * `CompressionStream`.
 *
 * @param bytes - The bytes.
 * @returns The stream's bytes.
 */
export async function deflateBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * An image composed over an opaque backdrop, without its alpha: a PDF page's RGB. Pure.
 *
 * @param pixels - The image, RGBA8 premultiplied.
 * @param backdrop - The backdrop.
 * @returns RGB8 bytes, rows top to bottom.
 */
export function rgbOverBackdrop(pixels: EnginePixels, backdrop: Rgba): Uint8Array {
  const rgba = overBackdrop(pixels, backdrop);
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let from = 0, to = 0; from < rgba.length; from += 4, to += 3) {
    rgb.set(rgba.subarray(from, from + 3), to);
  }
  return rgb;
}

/**
 * A page's size for an area: 0.75 pt a board unit, scaled down uniformly where its larger side
 * would pass {@link MAX_PAGE_POINTS}.
 *
 * @param rect - The area, board units.
 * @returns The page's width and height, pt.
 */
function pageSizeOf(rect: CaptureRect): Pick<PdfImagePage, 'widthPt' | 'heightPt'> {
  const widthPt = rect.width * POINTS_PER_UNIT;
  const heightPt = rect.height * POINTS_PER_UNIT;
  const fit = Math.min(1, MAX_PAGE_POINTS / Math.max(widthPt, heightPt));
  return { widthPt: widthPt * fit, heightPt: heightPt * fit };
}

/**
 * A PDF export's pages, each encoded as soon as it is drawn: composed over the
 * backdrop and deflated, so only its compressed bytes are kept, never every page's pixels at once.
 */
class PdfPages {
  /** The pages, by index; none until drawn. */
  readonly pages: (PdfImagePage | undefined)[];
  /** Whether every page drawn so far had settled. */
  isComplete = true;
  private readonly rects: readonly CaptureRect[];
  private readonly backdrop: Rgba;
  private readonly deflate: (bytes: Uint8Array) => Promise<Uint8Array>;

  /**
   * Starts with no page encoded.
   *
   * @param rects - The pages' areas, board units.
   * @param backdrop - The colour under the board.
   * @param deflate - Deflates a page's RGB bytes.
   */
  constructor(
    rects: readonly CaptureRect[],
    backdrop: Rgba,
    deflate: (bytes: Uint8Array) => Promise<Uint8Array>,
  ) {
    this.rects = rects;
    this.backdrop = backdrop;
    this.deflate = deflate;
    this.pages = rects.map(() => undefined);
  }

  /**
   * Encodes a drawn page.
   *
   * @param pixels - Its image.
   * @param index - Its place among the pages.
   * @returns Settles once it is encoded.
   */
  async add(pixels: CapturedExport, index: number): Promise<void> {
    const rect = this.rects[index];
    if (rect === undefined) return;
    this.isComplete &&= pixels.isComplete;
    const flateRgb = await this.deflate(rgbOverBackdrop(pixels, this.backdrop));
    const { widthPx, heightPx } = pixels;
    this.pages[index] = { ...pageSizeOf(rect), image: { widthPx, heightPx, flateRgb } };
  }

  /**
   * Every page, in order.
   *
   * @returns The pages.
   * @throws {Error} When a page was not drawn.
   */
  all(): PdfImagePage[] {
    return this.pages.map((page) => {
      if (page === undefined) throw new Error('A page of the export was not drawn.');
      return page;
    });
  }
}

/**
 * Draws each page at its scale, one capture per scale (one host when every page draws at 2×, the
 * usual case; a second for the pages that fall back to 1×), handing each page to `pages` as it
 * is drawn.
 *
 * @param scales - Each page's scale.
 * @param pages - Where the pages go.
 * @param draw - Draws areas at one scale, handing each image over as drawn (or returning them).
 * @returns Settles once every page is encoded.
 */
async function drawPages(
  scales: readonly number[],
  pages: PdfPages,
  draw: (
    indices: readonly number[],
    scale: number,
    onImage: (image: CapturedExport, at: number) => Promise<void>,
  ) => Promise<readonly CapturedExport[]>,
): Promise<void> {
  for (const scale of new Set(scales)) {
    const indices = [...scales.keys()].filter((index) => scales[index] === scale);
    const pageOf = (at: number): number => indices[at] ?? -1;
    const returned = await draw(indices, scale, (image, at) => pages.add(image, pageOf(at)));
    for (const [at, image] of returned.entries()) await pages.add(image, pageOf(at));
  }
}

/**
 * Exports the selection, or the page shown, as a PDF: `exportScopePdf` of what the
 * board menu's Export draws now (`resolveExport`).
 *
 * @param exporter - The shell's board, images, title, theme and notice.
 * @param dependencies - Replacements for the capture, the deflating and the download, in tests.
 * @returns Settles once the file is handed over, or the person told why not.
 */
export async function exportBoardPdf(
  exporter: BoardExporter,
  dependencies: PdfExportDependencies = {},
): Promise<void> {
  await exportScopePdf(resolveExport(exporter), exporter, dependencies);
}

/**
 * Exports a scope as a PDF (home's card menu): one page per section (a
 * top-level frame, in reading order; `exportSectionsOf`), or one page of the whole export when it
 * shows no frame; what lies outside every section is left out. Each page is its area drawn as
 * `captureExportAreas` draws it, at 2× (1× where 2× is over the capture limits), composed over
 * the theme's canvas colour and deflated as soon as it is drawn (only compressed pages are kept),
 * as an image filling a page of 0.75 pt a board unit (`writePdf`; no selectable text). Downloaded as `exportFileName`. The person is told as for a PNG.
 *
 * @param resolved - What it draws; undefined when there is nothing to export.
 * @param output - The images, title, theme and notice.
 * @param dependencies - Replacements for the capture, the deflating and the download, in tests.
 * @returns Settles once the file is handed over, or the person told why not.
 */
export async function exportScopePdf(
  resolved: ResolvedExport | undefined,
  output: ExportOutput,
  dependencies: PdfExportDependencies = {},
): Promise<void> {
  if (resolved === undefined) {
    output.notify(EXPORT_EMPTY_MESSAGE);
    return;
  }
  const { board, scope } = resolved;
  const sections = exportSectionsOf(board, scope);
  const rects = sections.length > 0 ? sections.map(({ rect }) => rect) : [scope.rect];
  const scales = rects.map((rect) => [PAGE_SCALE, 1].find((scale) => fitsCapture(rect, scale)));
  if (scales.some((scale) => scale === undefined)) {
    output.notify(EXPORT_TOO_LARGE_MESSAGE);
    return;
  }
  const capture = dependencies.captureAreas ?? captureExportAreas;
  const backdrop = canvasBackgroundOf(output.themeName);
  const pages = new PdfPages(rects, backdrop, dependencies.deflate ?? deflateBytes);
  try {
    await drawPages(
      scales.map((scale) => scale ?? 1),
      pages,
      (indices, scale, onImage) =>
        capture(
          scope,
          indices.map((index) => rects[index] ?? scope.rect),
          {
            scale,
            themeName: output.themeName,
            tokens: resolved.tokens,
            images: output.images,
            onImage,
          },
        ),
    );
    const file = new Blob([writePdf(pages.all())], { type: 'application/pdf' });
    (dependencies.save ?? downloadFile)(file, exportFileName(output.title, scope.kind, 'pdf'));
    if (!pages.isComplete) output.notify(EXPORT_INCOMPLETE_MESSAGE);
  } catch {
    output.notify(EXPORT_FAILED_MESSAGE);
  }
}
