import type { BoardObject } from '@canvas/schema';

/** The groups board search shows results in (comments come from the service). */
export type SearchGroup = 'stickies' | 'text' | 'sections';

/** An object's text as board search indexes it. */
export interface SearchableText {
  /** The group its results show in. */
  readonly group: SearchGroup;
  /** Its text, as written. */
  readonly text: string;
}

/**
 * The text board search finds an object by: a sticky's or a text object's text, a
 * shape's or a connector's label, a frame's name (the board's sections); nothing for any other
 * object, nor for empty text. Pure.
 *
 * @param object - The object.
 * @returns Its group and text, or undefined.
 */
export function searchableTextOf(object: BoardObject): SearchableText | undefined {
  const found = groupAndText(object);
  if (found === undefined || found.text.trim() === '') return undefined;
  return found;
}

/**
 * The group and the raw text an object would be found by, empty or not.
 *
 * @param object - The object.
 * @returns Its group and text, or undefined for a kind search does not read.
 */
function groupAndText(object: BoardObject): SearchableText | undefined {
  switch (object.type) {
    case 'sticky':
      return { group: 'stickies', text: object.text };
    case 'text':
      return { group: 'text', text: object.text };
    case 'shape':
    case 'connector':
      return object.label === null ? undefined : { group: 'text', text: object.label.text };
    case 'frame':
      return { group: 'sections', text: object.name };
    default:
      return undefined;
  }
}
