/**
 * A shelf this much taller than an item still takes it while the page has room for new shelves:
 * glyphs of one tier and size vary a little in height, but a small glyph on a shelf opened for a
 * high-tier glyph would waste most of it.
 */
const SNUG_SHELF_RATIO = 1.25;

/** A rectangle handed out by a {@link ShelfAllocator}, in texels. */
export interface ShelfAllocation {
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  /** Width. */
  readonly width: number;
  /** Height; the shelf's height, which may exceed the requested height. */
  readonly height: number;
}

/** A horizontal stretch of a shelf, used or free. */
interface Span {
  x: number;
  width: number;
  isFree: boolean;
}

/** A row of the page: fixed height, split into spans left to right. */
interface Shelf {
  readonly y: number;
  readonly height: number;
  readonly spans: Span[];
}

/**
 * Packs rectangles into shelves (rows) of a page, and frees them again for per-glyph LRU
 * eviction. An item goes into a free span of the shortest shelf that
 * holds it snugly, else opens a new shelf below the last one, else (the page is full) takes any
 * shelf tall enough. Freeing merges neighbouring free
 * spans, and empty shelves at the bottom are given back so a taller shelf can open there. The
 * prototype's `ShelfPacker` (`src/atlas/shelfPacker.ts`) could not free.
 */
export class ShelfAllocator {
  private readonly shelves: Shelf[] = [];
  private nextY = 0;

  /**
   * Creates an empty page.
   *
   * @param width - Page width, in texels.
   * @param height - Page height, in texels.
   */
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  /**
   * Whether nothing is allocated.
   *
   * @returns `true` when every allocation has been freed.
   */
  get isEmpty(): boolean {
    return this.shelves.length === 0;
  }

  /**
   * Places a rectangle.
   *
   * @param width - Its width, in texels.
   * @param height - Its height, in texels.
   * @returns Where it went, or `undefined` when the page has no room for it.
   */
  allocate(width: number, height: number): ShelfAllocation | undefined {
    if (width > this.width || height > this.height) return undefined;
    const snug = this.findSpan(width, height, Math.ceil(height * SNUG_SHELF_RATIO));
    if (snug !== undefined) return this.take(snug.shelf, snug.span, width);
    if (this.nextY + height <= this.height) {
      const shelf: Shelf = { y: this.nextY, height, spans: [] };
      const span: Span = { x: 0, width: this.width, isFree: true };
      shelf.spans.push(span);
      this.shelves.push(shelf);
      this.nextY += height;
      return this.take(shelf, span, width);
    }
    // The page has no room for a new shelf: accept any shelf tall enough.
    const loose = this.findSpan(width, height, Infinity);
    return loose === undefined ? undefined : this.take(loose.shelf, loose.span, width);
  }

  /**
   * Returns a rectangle to the page. Freeing one that is not allocated does nothing.
   *
   * @param allocation - A rectangle this allocator returned.
   */
  free(allocation: ShelfAllocation): void {
    const shelf = this.shelves.find((candidate) => candidate.y === allocation.y);
    const index = shelf?.spans.findIndex((span) => span.x === allocation.x && !span.isFree) ?? -1;
    const span = shelf?.spans[index];
    if (shelf === undefined || span === undefined) return;
    span.isFree = true;
    const next = shelf.spans[index + 1];
    if (next?.isFree === true) {
      span.width += next.width;
      shelf.spans.splice(index + 1, 1);
    }
    const previous = shelf.spans[index - 1];
    if (previous?.isFree === true) {
      previous.width += span.width;
      shelf.spans.splice(index, 1);
    }
    this.dropEmptyBottomShelves();
  }

  /**
   * Finds a free span in the shortest shelf whose height is in `[height, maxHeight]`.
   *
   * @param width - The width needed.
   * @param height - The height needed.
   * @param maxHeight - The tallest shelf to consider.
   * @returns The shelf and span, or `undefined`.
   */
  private findSpan(
    width: number,
    height: number,
    maxHeight: number,
  ): { shelf: Shelf; span: Span } | undefined {
    let best: { shelf: Shelf; span: Span } | undefined;
    for (const shelf of this.shelves) {
      const isCandidate =
        shelf.height >= height &&
        shelf.height <= maxHeight &&
        (best === undefined || shelf.height < best.shelf.height);
      const span = isCandidate
        ? shelf.spans.find((candidate) => candidate.isFree && candidate.width >= width)
        : undefined;
      if (span !== undefined) best = { shelf, span };
    }
    return best;
  }

  private take(shelf: Shelf, span: Span, width: number): ShelfAllocation {
    const index = shelf.spans.indexOf(span);
    if (span.width > width) {
      shelf.spans.splice(index + 1, 0, {
        x: span.x + width,
        width: span.width - width,
        isFree: true,
      });
      span.width = width;
    }
    span.isFree = false;
    return { x: span.x, y: shelf.y, width, height: shelf.height };
  }

  private dropEmptyBottomShelves(): void {
    for (let last = this.shelves.at(-1); last !== undefined; last = this.shelves.at(-1)) {
      if (last.spans.some((span) => !span.isFree)) return;
      this.shelves.pop();
      this.nextY = last.y;
    }
  }
}
