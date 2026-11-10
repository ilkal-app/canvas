import type { LodRule } from './lod-rule.js';

/**
 * The hysteresis band of every level-of-detail threshold, as a fraction of it, so continuous
 * zooming does not thrash: a cheaper form is taken as soon as the size on screen falls
 * under its threshold, and left only once the size reaches the threshold × 1.2.
 */
export const LOD_HYSTERESIS = 0.2;

/**
 * Text whose tallest line is under this many device pixels draws as greyed bars: the
 * glyphs would be an unreadable smudge, and bars need no atlas.
 */
export const TEXT_GREEK_LINE_PX = 4;

/**
 * Text whose tallest line is under this many device pixels is not drawn at all: a bar thinner
 * than this is noise, and text left out neither draws nor splits z-order segments, so a far
 * view of a board of notes is a few segments ('s provisional rule at 3 px, generalised to
 * every text with the 20% band: hidden under 2.5 px, shown again from 3 px).
 */
export const TEXT_HIDDEN_LINE_PX = 2.5;

/** An image whose longer on-screen edge is under this many device pixels draws its average colour. */
export const IMAGE_AVERAGE_COLOR_EDGE_PX = 8;

/**
 * A path (or line) whose box's longer side is under this many device pixels draws a straight
 * chord per segment.
 */
export const PATH_CHORD_BOUNDS_PX = 6;

/** Text: the tallest line's height on screen; greek bars under 4 px, nothing under 2.5 px. */
export const TEXT_LOD_RULE: LodRule = {
  kind: 'text',
  levels: [
    { form: 'greek', belowPx: TEXT_GREEK_LINE_PX },
    { form: 'hidden', belowPx: TEXT_HIDDEN_LINE_PX },
  ],
};

/** Images: the longer edge on screen; the average colour under 8 px. */
export const IMAGE_LOD_RULE: LodRule = {
  kind: 'image',
  levels: [{ form: 'average-color', belowPx: IMAGE_AVERAGE_COLOR_EDGE_PX }],
};

/**
 * Below this many device pixels of its longer side on screen a shape or a sticky note draws flat:
 * its box in its average colour, without distance arithmetic, padding or shadow. At
 * that size an edge's antialiasing is most of what the SDF draws, and on a board at fit tens of
 * thousands of shapes that small were nearly all of the scene's GPU time. Drawn in full again
 * from 4.8 px, with the 20% band.
 */
export const SHAPE_FLAT_EDGE_PX = 4;

/** SDF shapes and sticky notes: the longer side on screen; their average colour under 4 px. */
export const SHAPE_LOD_RULE: LodRule = {
  kind: 'shape',
  levels: [{ form: 'average-color', belowPx: SHAPE_FLAT_EDGE_PX }],
};

/** Paths and lines: the longer side of their box on screen; chords under 6 px. */
export const PATH_LOD_RULE: LodRule = {
  kind: 'path',
  levels: [{ form: 'chord', belowPx: PATH_CHORD_BOUNDS_PX }],
};

/**
 * A connector whose stroke is under this many device pixels wide is not drawn: at the
 * zoom where text turns to greek bars (a 2-wide stroke at 25%), a line that thin is a faint
 * smudge, and a connector left out neither meshes, draws nor splits z-order segments, so a far
 * view of a board holding thousands of connectors costs what it did before they were drawn.
 * Shown again from 0.6 px, with the 20% band.
 */
export const CONNECTOR_HIDDEN_STROKE_PX = 0.5;

/** Connectors: their stroke's width on screen; nothing under half a device pixel. */
export const CONNECTOR_LOD_RULE: LodRule = {
  kind: 'connector',
  levels: [{ form: 'hidden', belowPx: CONNECTOR_HIDDEN_STROKE_PX }],
};

/**
 * Below this many device pixels of a frame's width on screen its name is hidden: a
 * frame that small has no room for a title worth reading, and a board zoomed far out would
 * otherwise be covered in names. Shown again from 48 px, with the 20% band.
 */
export const FRAME_TITLE_HIDDEN_WIDTH_PX = 40;

/** Frame names: their frame's width on screen; hidden under 40 device pixels. */
export const FRAME_TITLE_LOD_RULE: LodRule = {
  kind: 'frame-title',
  levels: [{ form: 'hidden', belowPx: FRAME_TITLE_HIDDEN_WIDTH_PX }],
};

/**
 * A sticky's author label: its caption line on screen; hidden under 4 px, where no
 * name can be read (no greek bars: a smudge under every sticky says nothing).
 */
export const STICKY_AUTHOR_LOD_RULE: LodRule = {
  kind: 'sticky-author',
  levels: [{ form: 'hidden', belowPx: TEXT_GREEK_LINE_PX }],
};

/**
 * A link card's text: its title, description and domain as lines on screen; hidden
 * under 4 px, where the card's paper and preview say enough.
 */
export const LINK_CARD_TEXT_LOD_RULE: LodRule = {
  kind: 'link-card-text',
  levels: [{ form: 'hidden', belowPx: TEXT_GREEK_LINE_PX }],
};
