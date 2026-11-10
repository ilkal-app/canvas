// The engine's paint exports: gradient records, the paint table and the
// tolerant reader of paints and ink, and the colour token palettes, re-exported by the
// package entry.
export {
  GRADIENT_AVERAGE_COLOR_EDGE_PX,
  GRADIENT_LEVEL_OF_DETAIL,
  GRADIENT_LOD_RULE,
} from './gradient-detail.js';
export {
  GRADIENT_RECORD_FLOATS,
  GRADIENT_RECORD_TEXELS,
  LINEAR_GRADIENT_CODE,
  packGradientRecord,
  RADIAL_GRADIENT_CODE,
} from './gradient-record.js';
export { PAINT_TABLE_RECORDS_PER_ROW, PaintTable } from './paint-table.js';
export type { PaintTableUpload } from './paint-table.js';
export { BASE_COLOR, colorTokensOf, readFill, readInkable, usesInk } from './paint-reading.js';
export { ColorPalette, LIGHT_PALETTE, NO_COLOR_TOKENS } from './color-palette.js';
export type { ColorTokenValues, DeferredColor } from './color-palette.js';
