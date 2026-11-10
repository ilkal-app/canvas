import type { BoardObject, StyleRun, TextStyle } from '@canvas/schema';
import { LINE_HEIGHT_EM, NOTE_PADDING } from '@canvas/text';

import type { TextBoxGeometry } from './text-placement.js';

/**
 * Who wrote each sticky, as the board shows it: whether the board shows authors, each
 * principal's display name, and the name for a principal the map lacks. The app resolves names
 * from the board's members; the engine never does.
 */
export interface StickyAuthors {
  /** Whether stickies show their author. */
  readonly isShown: boolean;
  /** Each principal id (a sticky's `createdBy`) and its display name. */
  readonly names: ReadonlyMap<string, string>;
  /** The name of a principal the map lacks ("Former member" in the app). */
  readonly fallback: string;
}

/** No authors shown: the engine's default. */
export const NO_STICKY_AUTHORS: StickyAuthors = Object.freeze({
  isShown: false,
  names: new Map<string, string>(),
  fallback: 'Former member',
});

/** The most characters (code points) an author label shows; a longer name ends with '…'. */
export const STICKY_AUTHOR_MAX_CHARS = 32;

/** The label's caption style: Liberation Sans 11, the secondary ink on a sticky's paper. */
export const STICKY_AUTHOR_STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 11,
  color: [0.38, 0.39, 0.42, 1],
  weight: 400,
  italic: false,
};

/**
 * The author label a sticky shows: its author's display name, or the fallback for a principal
 * the names lack, trimmed and cut to {@link STICKY_AUTHOR_MAX_CHARS} code points.
 *
 * @param object - The object.
 * @param authors - The board's authors.
 * @returns The label, or undefined for an object that is not a sticky, authors hidden or an
 *   empty name.
 */
export function stickyAuthorTextOf(
  object: BoardObject,
  authors: StickyAuthors,
): string | undefined {
  if (!authors.isShown || object.type !== 'sticky') return undefined;
  const name = (authors.names.get(object.createdBy) ?? authors.fallback).trim();
  const points = Array.from(name);
  if (points.length === 0) return undefined;
  if (points.length <= STICKY_AUTHOR_MAX_CHARS) return name;
  return `${points.slice(0, STICKY_AUTHOR_MAX_CHARS - 1).join('')}…`;
}

/**
 * Where a sticky's author label lays out: one unwrapped caption line inside the paper's
 * bottom-left padding, in the sticky's frame and world units, apart from the note's own text.
 *
 * @param object - The object.
 * @param text - The label.
 * @returns The box, or undefined for an object that is not a sticky.
 */
export function stickyAuthorPlacement(
  object: BoardObject,
  text: string,
): TextBoxGeometry | undefined {
  if (object.type !== 'sticky') return undefined;
  const boxHeight = STICKY_AUTHOR_STYLE.fontSize * LINE_HEIGHT_EM;
  const runs: readonly StyleRun[] = [{ length: text.length, style: STICKY_AUTHOR_STYLE }];
  return {
    text,
    runs,
    wrapWidth: null,
    align: 'left',
    direction: 'auto',
    verticalAlign: 'top',
    boxHeight,
    origin: { x: NOTE_PADDING, y: object.height - NOTE_PADDING - boxHeight },
  };
}

/** Where the scene keeps a sticky's resolved author label on the object it hands the passes. */
export const STICKY_AUTHOR_LABEL: unique symbol = Symbol('stickyAuthorLabel');

/** A board object as the scene hands it to the passes, with a sticky's author label resolved. */
export type LabelledObject = BoardObject & { readonly [STICKY_AUTHOR_LABEL]?: string };

/**
 * The author label the scene resolved onto an object.
 *
 * @param object - The object as the scene hands it to the passes.
 * @returns The label, or undefined.
 */
export function resolvedStickyAuthorOf(object: BoardObject): string | undefined {
  return (object as LabelledObject)[STICKY_AUTHOR_LABEL];
}
