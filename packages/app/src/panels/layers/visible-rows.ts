/** The rows a virtualised list renders: `start` up to, not including, `end`. */
export interface RowRange {
  /** The first row rendered. */
  readonly start: number;
  /** One past the last row rendered. */
  readonly end: number;
}

/**
 * The rows a fixed-height virtualised list renders for a scroll position: those in view plus
 * `overscanRows` on each side, so a scroll of a few rows shows no gap before the next render.
 * O(1), so a list of 50k rows costs what a list of 50 does.
 *
 * @param rowCount - How many rows the list has.
 * @param scrollTopPx - How far the list is scrolled, CSS px.
 * @param viewportHeightPx - The list's visible height, CSS px.
 * @param rowHeightPx - Each row's height, CSS px, above 0.
 * @param overscanRows - Rows rendered beyond each edge of the view.
 * @returns The range, within [0, `rowCount`].
 */
export function visibleRows(
  rowCount: number,
  scrollTopPx: number,
  viewportHeightPx: number,
  rowHeightPx: number,
  overscanRows: number,
): RowRange {
  const first = Math.floor(Math.max(0, scrollTopPx) / rowHeightPx);
  const last = Math.ceil((Math.max(0, scrollTopPx) + Math.max(0, viewportHeightPx)) / rowHeightPx);
  return {
    start: Math.min(rowCount, Math.max(0, first - overscanRows)),
    end: Math.min(rowCount, last + overscanRows),
  };
}

/**
 * The scroll position that brings a row fully into view, moving as little as possible.
 *
 * @param index - The row.
 * @param scrollTopPx - The scroll position now, CSS px.
 * @param viewportHeightPx - The list's visible height, CSS px.
 * @param rowHeightPx - Each row's height, CSS px.
 * @returns The new scroll position, CSS px; `scrollTopPx` when the row is already in view.
 */
export function scrollToShow(
  index: number,
  scrollTopPx: number,
  viewportHeightPx: number,
  rowHeightPx: number,
): number {
  const top = index * rowHeightPx;
  if (top < scrollTopPx) return top;
  const bottom = top + rowHeightPx;
  return bottom > scrollTopPx + viewportHeightPx ? bottom - viewportHeightPx : scrollTopPx;
}

/** An item a virtualised list renders, with its index. */
export interface RenderedItem<Item> {
  /** Its index in the list. */
  readonly index: number;
  /** The item. */
  readonly item: Item;
}

/**
 * The items a virtualised list renders: those in the range, plus the keyboard focus target when
 * it is scrolled away, so the list keeps its tab stop.
 *
 * @param items - The list.
 * @param range - The rows in view (`visibleRows`).
 * @param focusTarget - The index of the row that takes keyboard focus.
 * @returns The items, in list order except for a focus target outside the range, which is last.
 */
export function renderedItems<Item>(
  items: readonly Item[],
  range: RowRange,
  focusTarget: number,
): RenderedItem<Item>[] {
  const rendered = items
    .slice(range.start, range.end)
    .map((item, offset) => ({ index: range.start + offset, item }));
  const isOutside = focusTarget < range.start || focusTarget >= range.end;
  const focused = isOutside ? items[focusTarget] : undefined;
  if (focused !== undefined) rendered.push({ index: focusTarget, item: focused });
  return rendered;
}
