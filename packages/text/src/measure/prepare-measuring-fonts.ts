import type { StyleRun } from '@canvas/schema';

import { fontFaceId, type FontFaceKey } from '../font/font-face.js';
import type { GlyphMeasurer } from '../layout/glyph-measurer.js';
import { loadShaper } from '../shaping/shaper.js';
import { createShapingMeasurer } from '../shaping/shaping-measurer.js';

import { measuringFontsFor, type MeasuringFonts } from './measure-text.js';

/**
 * Where agent-side measurement reads the font files of bundled faces: from disk in a
 * server, from the page's loaded fonts in the app. Pure code never reads files itself.
 */
export interface FontBytesSource {
  /**
   * Reads a bundled face's font file (`bundledFontFile` names it).
   *
   * @param face - The face.
   * @returns Its bytes, or `undefined` when the source lacks it.
   */
  bytesOf(face: FontFaceKey): Promise<Uint8Array | undefined>;
}

/** The fonts a text is measured with, and a measurer that shapes with their files. */
export interface PreparedMeasuringFonts extends MeasuringFonts {
  /** Shapes with HarfBuzz over every face of `fonts`; pass it to `measureText`. */
  readonly measurer: GlyphMeasurer;
}

/** Each source's font files by face id, read once: a server measures per call. */
const filesBySource = new WeakMap<FontBytesSource, Map<string, Promise<Uint8Array>>>();

/**
 * Reads a face's file through a source, once per source.
 *
 * @param source - The source.
 * @param face - The face.
 * @returns Its bytes.
 * @throws {Error} When the source has no file for the face.
 */
function fileOf(source: FontBytesSource, face: FontFaceKey): Promise<Uint8Array> {
  const files = filesBySource.get(source) ?? new Map<string, Promise<Uint8Array>>();
  filesBySource.set(source, files);
  const faceId = fontFaceId(face);
  let file = files.get(faceId);
  if (file === undefined) {
    file = source.bytesOf(face).then((bytes) => {
      if (bytes === undefined) {
        throw new Error(
          `No font file for ${face.family} ${String(face.weight)}${face.isItalic ? ' italic' : ''}.`,
        );
      }
      return bytes;
    });
    // A failed read is not kept, so a later call can try again.
    file.catch(() => files.delete(faceId));
    files.set(faceId, file);
  }
  return file;
}

/**
 * The fonts some texts are measured with ({@link measuringFontsFor}), with a measurer that
 * shapes them with HarfBuzz from their files, as the app lays them out. The shaper
 * loads once, and each face's file is read once per source.
 * Keep one source for the life of the process (a server's, the page's): every face of each
 * family named, and the symbol faces, are read, and a new source reads them all again.
 *
 * @param runSets - The runs of each text to be measured.
 * @param source - Where the faces' files are read.
 * @returns The fonts, the unknown families, the weight fallbacks and the shaping measurer.
 * @throws {Error} When the source has no file for one of the faces.
 */
export async function prepareMeasuringFonts(
  runSets: readonly (readonly StyleRun[])[],
  source: FontBytesSource,
): Promise<PreparedMeasuringFonts> {
  const measuring = measuringFontsFor(runSets);
  const [shaper, files] = await Promise.all([
    loadShaper(),
    Promise.all(measuring.fonts.map(({ face }) => fileOf(source, face))),
  ]);
  const fonts = measuring.fonts.map((metrics, index) => ({
    metrics,
    bytes: files[index] ?? new Uint8Array(),
  }));
  return { ...measuring, measurer: createShapingMeasurer(shaper, fonts) };
}
