import type { FontFaceKey } from '@canvas/engine';
import type { FontWeight } from '@canvas/schema';
import { collectionFaceCount, extractFace, postScriptNamesOf } from '@canvas/text';

import { checkFontBytes, type FontCheck } from './local-font-check.js';

/** Style-name words and the weight each names, most specific first ("semibold" before "bold"). */
const STYLE_WEIGHTS: readonly (readonly [RegExp, FontWeight])[] = [
  [/(extra|ultra)[\s-]?light/i, 200],
  [/(semi|demi)[\s-]?bold/i, 600],
  [/(extra|ultra)[\s-]?bold/i, 800],
  [/thin|hairline/i, 100],
  [/light/i, 300],
  [/medium/i, 500],
  [/black|heavy/i, 900],
  [/bold/i, 700],
];

/**
 * The weight a local face's style name names: `Thin` 100 to `Black` 900, regular 400.
 *
 * @param style - The face's style name, for example `SemiBold Italic`.
 * @returns The weight.
 */
export function weightOfStyleName(style: string): FontWeight {
  return STYLE_WEIGHTS.find(([pattern]) => pattern.test(style))?.[1] ?? 400;
}

/**
 * The largest local font file read, bytes: the browser refuses a font over 128 MiB
 * (Apple Color Emoji is 188 MB), so a larger file is left out unread rather than held in memory.
 */
export const MAX_LOCAL_FONT_FILE_BYTES = 128 * 1024 * 1024;

/** Browser-provided metadata; bytes remain on this computer. */
export interface LocalFace {
  readonly family: string;
  readonly style: string;
  /** The face's PostScript name, which picks it out of a collection file. */
  readonly postscriptName?: string;
  blob(): Promise<Blob>;
}
/** A supported local face, ready for the existing client renderer. */
export interface LocalFontFile {
  readonly face: FontFaceKey;
  readonly bytes: ArrayBuffer;
}

/** Enumerates only on explicit permission, then reads families on demand. */
export class LocalFontSource {
  private faces: readonly LocalFace[] = [];
  private readonly pending = new Map<string, Promise<readonly LocalFontFile[]>>();

  private readonly check: (bytes: ArrayBuffer) => Promise<FontCheck>;

  /**
   * Creates a source without asking permission or reading bytes.
   *
   * @param query - The browser's permission-gated API.
   * @param options - How a face's file is checked before it is offered.
   * @param options.check - Reads the file as the page will; `local-fonts.ts` runs it in a worker,
   *   and by default it runs here ({@link checkFontBytes}).
   */
  constructor(
    private readonly query: () => Promise<readonly LocalFace[]>,
    {
      check = checkFontBytes,
    }: { readonly check?: (bytes: ArrayBuffer) => Promise<FontCheck> } = {},
  ) {
    this.check = check;
  }

  /**
   * Requests permission through the browser and lists family names.
   *
   * @returns Distinct family names in display order.
   */
  async list(): Promise<readonly string[]> {
    this.faces = await this.query();
    return [...new Set(this.faces.map(({ family }) => family))].sort();
  }

  /**
   * Reads a family's static TrueType and CFF faces without any network request; a face of a
   * collection (TTC or OTC) is extracted into a file of its own.
   *
   * @param family - A previously enumerated family.
   * @returns Its supported faces.
   */
  load(family: string): Promise<readonly LocalFontFile[]> {
    let pending = this.pending.get(family);
    if (pending === undefined) {
      pending = this.read(family);
      this.pending.set(family, pending);
    }
    return pending;
  }

  private async read(family: string): Promise<readonly LocalFontFile[]> {
    const files: LocalFontFile[] = [];
    const candidates = this.faces
      .filter((face) => face.family === family)
      .sort((left, right) => facePriority(left.style) - facePriority(right.style));
    // The browser gives every face of a collection the whole file: it is read once per family,
    // by its size, so a family of six faces in a 78 MB collection reads 78 MB, not 470.
    const collections = new Map<number, ArrayBuffer>();
    for (const source of candidates) {
      const blob = await source.blob();
      if (blob.size > MAX_LOCAL_FONT_FILE_BYTES) continue;
      let bytes = sharedFaceOf(collections.get(blob.size), source.postscriptName);
      if (bytes === undefined) {
        const file = await blob.arrayBuffer();
        if (isCollection(file)) collections.set(blob.size, file);
        bytes = faceFileOf(file, source.postscriptName);
      }
      if (bytes === undefined || !isStaticSfnt(bytes)) continue;
      // Read off the page first: a file the check cannot read is never parsed here.
      if (!(await this.check(bytes)).isReadable) continue;
      const face = faceKeyOf(family, source, bytes);
      if (face !== undefined && !files.some((file) => isSameKey(file.face, face))) {
        files.push({ face, bytes });
      }
    }
    if (files.length === 0)
      throw new Error('Unavailable: this family needs static TrueType or CFF outlines.');
    return files;
  }
}

/** Style-name words a plain face may carry: weights and slants. */
const PLAIN_STYLE_WORDS =
  /(extra|ultra|semi|demi)?[\s-]?(thin|hairline|light|regular|normal|roman|book|medium|bold|black|heavy)|italic|oblique/giu;

/**
 * Whether a local face is its family's plain face for a weight and slant: its style
 * names nothing beyond weight and slant ("Light Italic", "Bold"), unlike "Condensed Bold" or
 * "Display".
 *
 * @param style - The face's style name.
 * @returns True for a plain face.
 */
export function isPlainStyle(style: string): boolean {
  return style.replace(PLAIN_STYLE_WORDS, '').replace(/[\s-]/gu, '') === '';
}

/**
 * The key a local face is installed under: a plain face by family, weight and slant; any
 * other by its PostScript name too (the browser's, else the font's own), so a family keeps every
 * face. A non-plain face with no name to tell it apart is left out.
 *
 * @param family - The family.
 * @param source - The browser's face.
 * @param bytes - The face's own file.
 * @returns The key, or `undefined` to leave the face out.
 */
function faceKeyOf(family: string, source: LocalFace, bytes: ArrayBuffer): FontFaceKey | undefined {
  const face: FontFaceKey = {
    family,
    weight: weightOfStyleName(source.style),
    isItalic: /italic|oblique/i.test(source.style),
  };
  if (isPlainStyle(source.style)) return face;
  const name = source.postscriptName ?? postScriptNamesOf(bytes)[0];
  return name === undefined ? undefined : { ...face, postScriptName: name };
}

/**
 * Whether two local faces would be one: a named face by its name, a plain one by weight and slant.
 *
 * @param first - One key.
 * @param second - The other.
 * @returns True for the same face.
 */
function isSameKey(first: FontFaceKey, second: FontFaceKey): boolean {
  if (first.postScriptName !== undefined || second.postScriptName !== undefined) {
    return first.postScriptName === second.postScriptName;
  }
  return first.weight === second.weight && first.isItalic === second.isItalic;
}

/**
 * Prefer the supported regular/bold faces before approximating another installed weight.
 * Browser enumeration order is not a weight preference.
 *
 * @param style - Browser-provided face style.
 * @returns Exact supported weights first, then other weights.
 */
function facePriority(style: string): number {
  const weight = style.replace(/italic|oblique/gi, '').trim();
  return /^(regular|normal|roman|bold)?$/i.test(weight) ? 0 : 1;
}

/** A collection file's tag, `ttcf`. */
const COLLECTION_TAG = 0x74746366;
/** The sfnt versions of TrueType (`0x00010000`, `true`) and CFF (`OTTO`) outlines. */
const SFNT_VERSIONS = new Set([0x00010000, 0x74727565, 0x4f54544f]);

/**
 * Whether a file is a collection (TTC or OTC) of faces.
 *
 * @param bytes - The file.
 * @returns True for a collection.
 */
function isCollection(bytes: ArrayBuffer): boolean {
  return bytes.byteLength >= 4 && new DataView(bytes).getUint32(0) === COLLECTION_TAG;
}

/**
 * A face from a collection this family already read: only one named in it, so another
 * file of the same size is never mistaken for it.
 *
 * @param collection - The collection read for a face of the same file size, if any.
 * @param postscriptName - The face's PostScript name.
 * @returns The face's own file, or `undefined` to read the face's file.
 */
function sharedFaceOf(
  collection: ArrayBuffer | undefined,
  postscriptName: string | undefined,
): ArrayBuffer | undefined {
  if (collection === undefined || postscriptName === undefined) return undefined;
  try {
    const index = postScriptNamesOf(collection).indexOf(postscriptName);
    return index < 0 ? undefined : (extractFace(collection, index).buffer as ArrayBuffer);
  } catch {
    return undefined;
  }
}

/**
 * The file of one local face. The browser gives every face of a collection the whole file, so its
 * face is found by PostScript name and extracted; a collection of one face needs no name.
 *
 * @param bytes - The face's file, as the browser gives it.
 * @param postscriptName - The face's PostScript name.
 * @returns The face's own file, or `undefined` for a collection without the face or a malformed one.
 */
function faceFileOf(
  bytes: ArrayBuffer,
  postscriptName: string | undefined,
): ArrayBuffer | undefined {
  if (!isCollection(bytes)) return bytes;
  try {
    let index = 0;
    if (collectionFaceCount(bytes) > 1) {
      index = postscriptName === undefined ? -1 : postScriptNamesOf(bytes).indexOf(postscriptName);
    }
    if (index < 0) return undefined;
    // extractFace returns a fresh array, so its buffer is exactly the face's file.
    return extractFace(bytes, index).buffer as ArrayBuffer;
  } catch {
    return undefined;
  }
}

/**
 * Rejects variable data and anything that is not one face with outlines: a static
 * sfnt with TrueType (`glyf`) or CFF (`CFF `, `CFF2`) outlines and no `fvar`.
 *
 * @param bytes - Browser-local sfnt bytes.
 * @returns Whether the file has supported static outlines.
 */
export function isStaticSfnt(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 12) return false;
  const view = new DataView(bytes);
  if (!SFNT_VERSIONS.has(view.getUint32(0))) return false;
  const count = view.getUint16(4);
  if (bytes.byteLength < 12 + count * 16) return false;
  const tags = Array.from({ length: count }, (unused, index) =>
    String.fromCharCode(...new Uint8Array(bytes, 12 + index * 16, 4)),
  );
  const hasOutlines = tags.includes('glyf') || tags.includes('CFF ') || tags.includes('CFF2');
  return hasOutlines && !tags.includes('fvar');
}
