import type { Rgba } from '@canvas/schema';

/** One colour of the sticky note palette. */
export interface NoteColor {
  /** The colour's name, which the palette's swatch is labelled with. */
  readonly name: string;
  /** The note's fill, straight-alpha sRGB, each channel in [0, 1]; frozen: copy to change it. */
  readonly color: Readonly<Rgba>;
}

/**
 * One palette entry, frozen with its colour, so no caller can recolour the palette.
 *
 * @param name - The colour's name.
 * @param color - The colour.
 * @returns The frozen entry.
 */
function noteColor(name: string, color: Rgba): NoteColor {
  return Object.freeze({ name, color: Object.freeze(color) });
}

/** The palette's first colour, the default. */
const YELLOW = noteColor('Yellow', [1, 0.92, 0.55, 1]);

/**
 * The sticky note palette: the prototype's six colours,
 * in its order (webgl-whiteboard `src/board/note.ts`). Yellow comes first
 * and is the default; the sticky tool gives a new note the colour last picked. Deeply frozen:
 * the list, each entry and each colour.
 */
export const NOTE_COLORS: readonly NoteColor[] = Object.freeze([
  YELLOW,
  noteColor('Pink', [1, 0.74, 0.8, 1]),
  noteColor('Green', [0.74, 0.91, 0.66, 1]),
  noteColor('Blue', [0.66, 0.84, 0.98, 1]),
  noteColor('Orange', [1, 0.8, 0.55, 1]),
  noteColor('Purple', [0.83, 0.76, 0.96, 1]),
]);

/** A new note's colour until another is picked: the palette's first, yellow (the same frozen value). */
export const DEFAULT_NOTE_COLOR: Readonly<Rgba> = YELLOW.color;

/**
 * The palette name of a colour, compared channel by channel. Pure.
 *
 * @param color - A note's colour.
 * @returns Its name, or `undefined` for a colour off the palette.
 */
export function noteColorName(color: Readonly<Rgba>): string | undefined {
  return NOTE_COLORS.find((entry) =>
    entry.color.every((channel, index) => channel === color[index]),
  )?.name;
}
