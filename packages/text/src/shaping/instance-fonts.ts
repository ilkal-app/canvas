// The fonts a shaper keeps for variable faces' instances: one HarfBuzz font per face
// object, at most a fixed number of them, the least recently used dropped first. A dropped font
// is made again when its face is next used, so a face a caller holds never stops working.

/**
 * The most instance fonts a shaper keeps: a slider dragged across an axis makes a face per grid
 * step it passes, and each font costs HarfBuzz's per-font tables, so only the recent ones stay.
 */
export const MAX_VARIATION_INSTANCES = 32;

/**
 * Fonts by the face they draw, the least recently used dropped first.
 *
 * @template Face - The face object a font draws.
 * @template Font - The font.
 */
export class InstanceFonts<Face, Font> {
  private readonly fonts = new Map<Face, Font>();

  /**
   * An empty set of fonts.
   *
   * @param make - Makes a face's font.
   * @param dropped - Called with each face whose font is dropped, when given.
   */
  constructor(
    private readonly make: (face: Face) => Font,
    private readonly dropped?: (face: Face) => void,
  ) {}

  /**
   * A face's font, made when it has none, and now the most recently used.
   *
   * @param face - The face.
   * @returns Its font.
   */
  fontOf(face: Face): Font {
    const known = this.fonts.get(face);
    if (known !== undefined) {
      this.fonts.delete(face);
      this.fonts.set(face, known);
      return known;
    }
    const font = this.make(face);
    this.fonts.set(face, font);
    for (const oldest of this.fonts.keys()) {
      if (this.fonts.size <= MAX_VARIATION_INSTANCES) break;
      this.fonts.delete(oldest);
      this.dropped?.(oldest);
    }
    return font;
  }
}
