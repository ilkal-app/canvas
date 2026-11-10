import {
  hitRect,
  sortTopmostFirst,
  type HitRectMode,
  type SpatialSearch,
  type WorldBounds,
} from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import type { SelectionSource } from './selection-geometry.js';

/** How a marquee's raw hits become its selection: targets, eligibility, topmost (`hitRect`). */
export type MarqueeSelect = (
  raw: readonly ObjectId[],
  rect: WorldBounds,
  mode: HitRectMode,
  enteredGroupId: ObjectId | null,
) => ObjectId[];

/**
 * The parts of a rectangle outside another, at most four strips.
 *
 * @param box - The rectangle.
 * @param other - The one taken away.
 * @returns The strips; the rectangle itself when they do not meet.
 */
function outside(box: WorldBounds, other: WorldBounds): WorldBounds[] {
  if (
    box.maxX < other.minX ||
    other.maxX < box.minX ||
    box.maxY < other.minY ||
    other.maxY < box.minY
  )
    return [box];
  const strips: WorldBounds[] = [];
  if (box.minX < other.minX) strips.push({ ...box, maxX: other.minX });
  if (box.maxX > other.maxX) strips.push({ ...box, minX: other.maxX });
  const minX = Math.max(box.minX, other.minX);
  const maxX = Math.min(box.maxX, other.maxX);
  if (box.minY < other.minY) strips.push({ minX, maxX, minY: box.minY, maxY: other.minY });
  if (box.maxY > other.maxY) strips.push({ minX, maxX, minY: other.maxY, maxY: box.maxY });
  return strips;
}

/**
 * One marquee drag's hits, kept between pointer moves. An object whose indexed box
 * meets neither strip between the last rectangle and the new one, and whose tested geometry lies
 * inside that box, is selected by both rectangles alike in either mode. So a move tests only the
 * objects in those strips (at most eight queries), the few whose geometry reaches outside their
 * box, and any that read as absent (a preview may hide an object and show it again). It starts
 * over when the mode or the entered group changes, or the document does.
 */
export class MarqueeHits {
  private last:
    | {
        readonly rect: WorldBounds;
        readonly mode: HitRectMode;
        readonly enteredGroupId: ObjectId | null;
        readonly generation: number;
        readonly ids: ObjectId[];
      }
    | undefined;
  private readonly raw = new Set<ObjectId>();
  private readonly absent = new Set<ObjectId>();
  /** Objects whose tested geometry reaches outside their indexed box: tested on every move. */
  private readonly loose = new Set<ObjectId>();

  /**
   * Starts with no hits.
   *
   * @param index - The index the hits come from.
   * @param source - The document as hit testing reads it.
   * @param select - Turns raw hits into the marquee's selection.
   */
  constructor(
    private readonly index: SpatialSearch & {
      boundsOf?(id: ObjectId): WorldBounds | undefined;
    },
    private readonly source: SelectionSource,
    private readonly select: MarqueeSelect,
  ) {}

  /**
   * The marquee's selection for a rectangle: the same array as last time when it is unchanged.
   *
   * @param rect - The marquee, world units.
   * @param mode - Touching or enclosing.
   * @param enteredGroupId - The entered group the marquee stays inside.
   * @param generation - The document's change count: another value starts over.
   * @returns The selected ids, topmost first.
   */
  update(
    rect: WorldBounds,
    mode: HitRectMode,
    enteredGroupId: ObjectId | null,
    generation: number,
  ): ObjectId[] {
    const { last } = this;
    const isFresh =
      last?.mode !== mode ||
      last.enteredGroupId !== enteredGroupId ||
      last.generation !== generation;
    const candidates = new Set<ObjectId>(this.absent);
    if (isFresh) {
      this.raw.clear();
      this.loose.clear();
      for (const id of this.index.searchRect(rect)) candidates.add(id);
    } else {
      for (const strip of [...outside(rect, last.rect), ...outside(last.rect, rect)])
        for (const id of this.index.searchRect(strip)) candidates.add(id);
    }
    this.absent.clear();
    for (const id of candidates) {
      this.raw.delete(id);
      if (this.source.get(id) === undefined) this.absent.add(id);
      else this.classify(id);
    }
    for (const id of this.loose) {
      candidates.add(id);
      this.raw.delete(id);
    }
    const tested = [...candidates];
    for (const id of hitRect({ searchRect: () => tested }, this.source, rect, mode)) {
      this.raw.add(id);
    }
    const raw = sortTopmostFirst([...this.raw], this.source);
    const ids = this.select(raw, rect, mode, enteredGroupId);
    const kept = last?.ids;
    const isSame = kept?.length === ids.length && kept.every((id, index) => id === ids[index]);
    this.last = { rect, mode, enteredGroupId, generation, ids: isSame ? kept : ids };
    return this.last.ids;
  }

  /**
   * Notes whether an object's tested geometry lies within its indexed box (a marquee of that box
   * encloses it): only then does the strip rule hold for it. One that reaches outside (a rotated
   * rounded frame's sharp pick corners, say), or an index that gives no boxes, is tested on every
   * move. Every object a fresh `hitRect` could select has its box in some earlier query, so each
   * is classified before it matters.
   *
   * @param id - A candidate, present in the source.
   */
  private classify(id: ObjectId): void {
    const box = this.index.boundsOf?.(id);
    const isTight =
      box !== undefined &&
      hitRect({ searchRect: () => [id] }, this.source, box, 'contain').length === 1;
    if (isTight) this.loose.delete(id);
    else this.loose.add(id);
  }
}
