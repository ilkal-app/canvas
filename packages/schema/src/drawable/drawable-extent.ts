/**
 * How far from the origin an object's geometry may lie on the board and still be drawn, world
 * units: 2^31 on each axis, twice the board's bound of ±2^30 that commands keep coordinates and
 * sizes within. Twice, so an honest object at the edge of the board, with its stroke,
 * its label's overflow or a child placed far in a far frame's own frame, is never refused; and
 * no more, so every quantity a renderer forms from a drawn object stays finite: a corner at zoom
 * 64 (2^37 device px), a box's area in the R-tree (2^64), the squared distance between two far
 * corners (2^66), all far inside float32's range (about 2^128). Only a client that skips the
 * command layer can write past it.
 */
export const DRAWABLE_EXTENT = 2 ** 31;

/**
 * The widest size an object may hold and be drawn where the schema sets no narrower bound (a
 * width, a height, a corner radius, an image's natural size, the whole image behind a crop): the
 * whole extent, side to side. Stroke widths (64) and font sizes (4 to 400) keep the schema's.
 */
export const MAX_DRAWABLE_SIZE = 2 * DRAWABLE_EXTENT;

/**
 * The largest finite float32, about 3.4e38: a number past it is finite in JavaScript but
 * infinite once written to a GPU instance buffer (a `Float32Array`), so it is out of range
 * wherever it is not already held to a narrower one.
 */
export const FLOAT32_MAX = 3.4028234663852886e38;

/**
 * Why an object, or a value of one, is not drawable:
 *
 * - `not-finite`: a number read from it (a coordinate, a size, a rotation, a point, a vertex, a
 *   handle, a colour channel, a crop, a font size) is NaN or infinite.
 * - `negative-size`: a width, height, corner radius, stroke width or font size is below 0.
 * - `past-extent`: its geometry on the board lies past ±{@link DRAWABLE_EXTENT}, or a size is
 *   wider than the whole extent.
 * - `out-of-range`: a number past its range: a colour channel, opacity or crop outside [0, 1]
 *   or a crop past the image's edge, `sides` not an integer from 3 to 64, a stroke wider than
 *   64, a font size outside 4 to 400, a natural size that is not a whole number from 1, no run
 *   or runs that do not cover the text, a kind or cap the schema does not list, or any other
 *   number past float32's range (about 3.4e38), which a GPU buffer would hold as infinite.
 * - `undrawable-parent`: a frame or group it sits in is not drawable, so its place on the board
 *   cannot be worked out.
 */
export type UndrawableReason =
  'not-finite' | 'negative-size' | 'past-extent' | 'out-of-range' | 'undrawable-parent';
