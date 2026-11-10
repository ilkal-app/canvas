// A font's embedding rights: the OS/2 table's fsType, read before an export embeds the
// font for selectable text. Pure.
import { SfntFile } from '../font/sfnt-file.js';

/** What a font's licence lets an export do with it, from OS/2 fsType. */
export interface FontEmbedding {
  /** Whether the font may be embedded at all (not restricted-licence, 0x0002). */
  readonly canEmbed: boolean;
  /** Whether a document embedding it may be edited (installable or editable). */
  readonly canEdit: boolean;
  /** Whether it may be subset; false when it must be embedded whole (0x0100). */
  readonly canSubset: boolean;
  /** Whether only its bitmaps may be embedded, not its outlines (0x0200). */
  readonly isBitmapOnly: boolean;
}

/** fsType's offset in the OS/2 table: after version, xAvgCharWidth, weight and width classes. */
const FS_TYPE_OFFSET = 8;

/** The first OS/2 version whose fsType bits 8 and 9 mean anything; earlier ones ignore them. */
const SUBSET_FLAGS_VERSION = 2;

/** What a font with no readable OS/2 table may do: nothing. */
const NOT_EMBEDDABLE: FontEmbedding = {
  canEmbed: false,
  canEdit: false,
  canSubset: true,
  isBitmapOnly: false,
};

/**
 * A font's embedding rights from its OS/2 `fsType`. The usage bits: 0 installable (embeddable
 * and editable); 0x0002 restricted (not embeddable); 0x0004 preview & print (embeddable, not
 * editable); 0x0008 editable. Bits 8 (no subsetting) and 9 (bitmap only) count from OS/2
 * version 2, as the OpenType specification says; earlier versions ignore them. A file whose table
 * directory or OS/2 table cannot be read may not be embedded.
 *
 * @param fontBytes - The font file (an sfnt, not a WOFF wrapper).
 * @returns What an export may do with it.
 */
export function fsTypeOf(fontBytes: Uint8Array): FontEmbedding {
  let flags: number;
  try {
    const file = new SfntFile(fontBytes.slice().buffer);
    if (!file.hasTable('OS/2')) return NOT_EMBEDDABLE;
    const os2 = file.table('OS/2');
    const read = os2.getUint16(FS_TYPE_OFFSET);
    flags = os2.getUint16(0) >= SUBSET_FLAGS_VERSION ? read : read & 0x00ff;
  } catch {
    return NOT_EMBEDDABLE;
  }
  const isRestricted = (flags & 0x000f) === 0x0002;
  const isPreviewOnly = (flags & 0x0004) !== 0 && (flags & 0x0008) === 0;
  return {
    canEmbed: !isRestricted,
    canEdit: !isRestricted && !isPreviewOnly,
    canSubset: (flags & 0x0100) === 0,
    isBitmapOnly: (flags & 0x0200) !== 0,
  };
}
