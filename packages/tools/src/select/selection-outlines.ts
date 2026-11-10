import type { ObjectId } from '@canvas/schema';

import type { OrientedBox } from './oriented-box.js';

/**
 * The most objects the selection overlay outlines one by one. A larger selection (select
 * all on a big board) shows the frame round it all with a count badge instead: its outlines
 * would be four rectangles per object, rebuilt at every zoom a glide draws, where 50,000 selected
 * objects meant 200,000 rectangles a frame. At this size the outlines still read as objects.
 */
export const MAX_OUTLINED_OBJECTS = 500;

/** The selection's part of the overlay model: its outlines, or its count once they are capped. */
export interface SelectionOutlines {
  /** Each selected object's box, when more than one and at most the cap are selected. */
  readonly outlines: readonly OrientedBox[];
  /** The selection's size when it is above the cap and not outlined; otherwise undefined. */
  readonly countBadge: number | undefined;
}

const NO_OUTLINES: SelectionOutlines = Object.freeze({
  outlines: Object.freeze([]),
  countBadge: undefined,
});

/**
 * What the overlay shows of each selected object: nothing for a single
 * object (its frame is its outline); each object's box for a multi-selection of up to
 * {@link MAX_OUTLINED_OBJECTS}; above that, only the count, without reading a single box, so a
 * large selection costs the page and the renderer the same as the cap. Pure.
 *
 * @param ids - The selected ids.
 * @param boxOf - An object's box, world units, or undefined when it has none.
 * @returns The outlines, or the count.
 */
export function selectionOutlinesOf(
  ids: readonly ObjectId[],
  boxOf: (id: ObjectId) => OrientedBox | undefined,
): SelectionOutlines {
  if (ids.length <= 1) return NO_OUTLINES;
  if (ids.length > MAX_OUTLINED_OBJECTS) return { outlines: [], countBadge: ids.length };
  return { outlines: ids.flatMap((id) => boxOf(id) ?? []), countBadge: undefined };
}
