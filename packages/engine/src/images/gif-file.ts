/** One image of a GIF as the file stores it, still compressed. */
export interface GifFrameRecord {
  /** Its left edge on the canvas, px. */
  readonly left: number;
  /** Its top edge on the canvas, px. */
  readonly top: number;
  /** Its width, px. */
  readonly width: number;
  /** Its height, px. */
  readonly height: number;
  /** Its colour table, 8-bit RGB triples: its own, or the file's global one. */
  readonly palette: Uint8Array;
  /** The palette index drawn transparent, if any. */
  readonly transparentIndex: number | undefined;
  /** How long it shows, ms, as stored (before `gifFrameDurationMs`). */
  readonly delayMs: number;
  /** Its disposal method: 0 or 1 keep it, 2 clears its rectangle, 3 restores what was under it. */
  readonly disposal: number;
  /** Whether its rows are stored interlaced. */
  readonly isInterlaced: boolean;
  /** The LZW minimum code size. */
  readonly minCodeSize: number;
  /** Its LZW data, sub-blocks joined. */
  readonly data: Uint8Array;
}

/** A GIF's structure (GIF87a or GIF89a), its images still compressed (`parseGif`). */
export interface GifFile {
  /**
   * The canvas width, px: the logical screen's, grown to the first image with its offset, as
   * browsers and the app's header reader size a GIF.
   */
  readonly widthPx: number;
  /** The canvas height, px, grown the same way. */
  readonly heightPx: number;
  /** The images, in order. */
  readonly frames: readonly GifFrameRecord[];
  /**
   * The NETSCAPE2.0 loop count: 0 loops forever, n plays n + 1 times; undefined when the file
   * has none, so it plays once.
   */
  readonly loopCount: number | undefined;
}

/** Row offsets and steps of the four interlace passes (GIF89a, appendix E). */
const INTERLACE_PASSES: readonly (readonly [number, number])[] = [
  [0, 8],
  [4, 8],
  [2, 4],
  [1, 2],
];

/**
 * The rows of an image in the order they are stored.
 *
 * @param height - Its height, px.
 * @param isInterlaced - Whether it is interlaced.
 * @returns The row numbers, in storage order.
 */
export function gifRowOrder(height: number, isInterlaced: boolean): number[] {
  if (!isInterlaced) return Array.from({ length: height }, (unused, row) => row);
  const rows: number[] = [];
  for (const [start, step] of INTERLACE_PASSES) {
    for (let row = start; row < height; row += step) rows.push(row);
  }
  return rows;
}

/** Most images a GIF may have before `parseGif` refuses it. */
export const MAX_GIF_FRAMES = 1000;

/** What one graphic control extension says about the next image. */
interface Control {
  readonly delayMs: number;
  readonly disposal: number;
  readonly transparentIndex: number | undefined;
}

const NO_CONTROL: Control = { delayMs: 0, disposal: 0, transparentIndex: undefined };

/** A cursor over the file's bytes. */
class GifReader {
  offset = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /**
   * Reads one byte.
   *
   * @returns The byte.
   * @throws {RangeError} When the file ends here (`DataView` refuses the read).
   */
  byte(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  word(): number {
    return this.byte() | (this.byte() << 8);
  }

  slice(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) {
      throw new RangeError('The GIF ends in the middle of a block.');
    }
    const view = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return view;
  }

  get isAtEnd(): boolean {
    return this.offset >= this.bytes.length;
  }

  /**
   * Reads data sub-blocks up to their terminator.
   *
   * @returns The sub-blocks.
   */
  subBlocks(): Uint8Array[] {
    const blocks: Uint8Array[] = [];
    for (let size = this.byte(); size !== 0; size = this.byte()) blocks.push(this.slice(size));
    return blocks;
  }
}

/**
 * Joins sub-blocks into one array.
 *
 * @param blocks - The sub-blocks.
 * @returns Their bytes, in order.
 */
function joined(blocks: readonly Uint8Array[]): Uint8Array {
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out;
}

/**
 * Whether bytes start with a GIF signature (`GIF87a` or `GIF89a`).
 *
 * @param bytes - The file's first bytes.
 * @returns True for a GIF.
 */
export function isGif(bytes: Uint8Array): boolean {
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  return signature === 'GIF87a' || signature === 'GIF89a';
}

/**
 * Reads a graphic control extension's body.
 *
 * @param reader - The reader, after the label.
 * @returns What it says.
 */
function readControl(reader: GifReader): Control {
  const body = joined(reader.subBlocks());
  if (body.length < 4) return NO_CONTROL;
  const view = new DataView(body.buffer);
  const packed = view.getUint8(0);
  const delayMs = view.getUint16(1, true) * 10;
  const transparentIndex = (packed & 1) === 1 ? view.getUint8(3) : undefined;
  return { delayMs, disposal: (packed >> 2) & 7, transparentIndex };
}

/**
 * Reads an application extension, keeping a NETSCAPE2.0 (or ANIMEXTS1.0) loop count.
 *
 * @param reader - The reader, after the label.
 * @returns The loop count, if it is one.
 */
function readApplication(reader: GifReader): number | undefined {
  const [identity = new Uint8Array(0), data = new Uint8Array(0)] = reader.subBlocks();
  const name = String.fromCharCode(...identity);
  if (name !== 'NETSCAPE2.0' && name !== 'ANIMEXTS1.0') return undefined;
  if (data.length < 3) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint8(0) === 1 ? view.getUint16(1, true) : undefined;
}

/**
 * Reads one image descriptor and its data.
 *
 * @param reader - The reader, after the separator.
 * @param globalPalette - The file's colour table, if any.
 * @param control - The graphic control extension before it.
 * @returns The image.
 * @throws {RangeError} When it has no colour table or the file ends inside it.
 */
function readImage(
  reader: GifReader,
  globalPalette: Uint8Array | undefined,
  control: Control,
): GifFrameRecord {
  const left = reader.word();
  const top = reader.word();
  const width = reader.word();
  const height = reader.word();
  const packed = reader.byte();
  const localPalette =
    (packed & 0x80) === 0 ? undefined : reader.slice(3 * 2 ** ((packed & 7) + 1));
  const palette = localPalette ?? globalPalette;
  if (palette === undefined) throw new RangeError('A GIF image has no colour table.');
  const minCodeSize = reader.byte();
  const data = joined(reader.subBlocks());
  return {
    left,
    top,
    width,
    height,
    palette,
    transparentIndex: control.transparentIndex,
    delayMs: control.delayMs,
    disposal: control.disposal,
    isInterlaced: (packed & 0x40) !== 0,
    minCodeSize,
    data,
  };
}

/**
 * Reads a GIF's structure without decoding its images (GIF89a): the canvas size, each image's
 * rectangle, colour table, transparency, delay, disposal and compressed data, and the loop count.
 * Unknown extensions are skipped; a file cut after at least one image keeps the images it has, as
 * browsers do. Pure: the bytes are not changed, and the images keep views of them.
 *
 * @param bytes - The file.
 * @returns Its structure.
 * @throws {RangeError} When it is not a GIF, has no image, has more than {@link MAX_GIF_FRAMES},
 *   or is malformed before its first image.
 */
export function parseGif(bytes: Uint8Array): GifFile {
  if (!isGif(bytes)) throw new RangeError('The file is not a GIF.');
  const reader = new GifReader(bytes);
  reader.slice(6);
  const screenWidth = reader.word();
  const screenHeight = reader.word();
  const packed = reader.byte();
  reader.slice(2);
  const globalPalette =
    (packed & 0x80) === 0 ? undefined : reader.slice(3 * 2 ** ((packed & 7) + 1));
  const frames: GifFrameRecord[] = [];
  let loopCount: number | undefined;
  let control = NO_CONTROL;
  let isTooLong = false;
  try {
    while (!reader.isAtEnd) {
      const introducer = reader.byte();
      if (introducer === 0x3b) break;
      if (introducer === 0x2c) {
        isTooLong = frames.length >= MAX_GIF_FRAMES;
        if (isTooLong) break;
        frames.push(readImage(reader, globalPalette, control));
        control = NO_CONTROL;
      } else if (introducer === 0x21) {
        const label = reader.byte();
        if (label === 0xf9) control = readControl(reader);
        else if (label === 0xff) loopCount = readApplication(reader) ?? loopCount;
        else reader.subBlocks();
      } else {
        throw new RangeError(`The GIF has an unknown block (${String(introducer)}).`);
      }
    }
  } catch (error) {
    if (frames.length === 0) throw error;
  }
  if (isTooLong) throw new RangeError(`The GIF has more than ${String(MAX_GIF_FRAMES)} frames.`);
  const [first] = frames;
  if (first === undefined) throw new RangeError('The GIF has no image.');
  return {
    widthPx: Math.max(screenWidth, first.left + first.width),
    heightPx: Math.max(screenHeight, first.top + first.height),
    frames,
    loopCount,
  };
}
