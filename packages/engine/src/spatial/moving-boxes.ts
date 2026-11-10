import type { ObjectId, Point } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';

/**
 * The boxes of the root leaves a retained move is placing, kept out of the R-tree
 * while they move: each box as it was indexed at the session's start, translated by its
 * object's displacement since, in typed arrays, so a drag frame re-indexes nothing and allocates
 * nothing per object. A text's drawing bounds, published at its current place while it moves, are
 * kept beside its box. Queries scan every moving box (a few microseconds for 10k). Pure.
 */
export class MovingBoxes {
  private ids: readonly ObjectId[] = [];
  private readonly indexById = new Map<ObjectId, number>();
  /** Per object: geometry box at the start (minX, minY, maxX, maxY), NaN for none. */
  private base = new Float64Array(0);
  /** Per object: its position at the start, then its displacement since (dx, dy). */
  private origin = new Float64Array(0);
  private shift = new Float64Array(0);
  /** A displacement every object shares on top of its own (`translate`). */
  private uniformX = 0;
  private uniformY = 0;
  private readonly drawing = new Map<number, WorldBounds>();
  private indexed = 0;

  /**
   * How many moving objects have a box.
   *
   * @returns The count.
   */
  get size(): number {
    return this.indexed;
  }

  /**
   * Whether a session is on, even one whose objects have no box.
   *
   * @returns True between `begin` and `end`.
   */
  get isActive(): boolean {
    return this.ids.length > 0;
  }

  /**
   * Starts a session.
   *
   * @param ids - The moving objects, in placement order.
   * @param boxOf - Each one's indexed geometry box and drawing bounds now, if any.
   * @param positions - Their positions now, `x, y` per object.
   */
  begin(
    ids: readonly ObjectId[],
    boxOf: (id: ObjectId) => { box: WorldBounds; drawing: WorldBounds | undefined } | undefined,
    positions: Float64Array,
  ): void {
    this.end();
    this.ids = ids;
    this.base = new Float64Array(ids.length * 4).fill(Number.NaN);
    this.origin = positions.slice(0, ids.length * 2);
    this.shift = new Float64Array(ids.length * 2);
    this.uniformX = 0;
    this.uniformY = 0;
    ids.forEach((id, index) => {
      this.indexById.set(id, index);
      const found = boxOf(id);
      if (found === undefined) return;
      const { box, drawing } = found;
      this.base.set([box.minX, box.minY, box.maxX, box.maxY], index * 4);
      if (drawing) this.drawing.set(index, drawing);
      this.indexed += 1;
    });
  }

  /**
   * Moves every object to its new position.
   *
   * @param positions - The positions now, `x, y` per object.
   * @param query - A region whose membership the caller tracks, if any.
   * @returns The objects that entered or left `query` (none without one).
   */
  move(positions: Float64Array, query?: WorldBounds): ObjectId[] {
    this.foldUniform();
    const { ids, origin, shift } = this;
    const flipped: ObjectId[] = [];
    for (let index = 0; index < ids.length; index += 1) {
      const dx = (positions[index * 2] ?? 0) - (origin[index * 2] ?? 0);
      const dy = (positions[index * 2 + 1] ?? 0) - (origin[index * 2 + 1] ?? 0);
      if (dx === shift[index * 2] && dy === shift[index * 2 + 1]) continue;
      const was = query !== undefined && this.meets(index, query);
      shift[index * 2] = dx;
      shift[index * 2 + 1] = dy;
      const id = ids[index];
      if (query !== undefined && id !== undefined && was !== this.meets(index, query))
        flipped.push(id);
    }
    return flipped;
  }

  /**
   * Sets a displacement every object shares on top of its own (a drag that translates
   * the whole session), writing nothing per object. A later `move` folds it in.
   *
   * @param dx - The shared displacement along x.
   * @param dy - Along y.
   * @param query - A region whose membership the caller tracks, if any.
   * @returns The objects that entered or left `query` (none without one).
   */
  translate(dx: number, dy: number, query?: WorldBounds): ObjectId[] {
    const flipped: ObjectId[] = [];
    const { uniformX, uniformY, ids } = this;
    if (dx === uniformX && dy === uniformY) return flipped;
    this.uniformX = dx;
    this.uniformY = dy;
    if (query === undefined) return flipped;
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      const was = this.meetsShifted(index, query, uniformX, uniformY);
      if (id !== undefined && was !== this.meets(index, query)) flipped.push(id);
    }
    return flipped;
  }

  /**
   * Replaces a moving object's drawing bounds, given at its current place.
   *
   * @param id - The object.
   * @param drawing - Its drawing bounds, or undefined for none.
   * @returns Its box before and after, or undefined when it is not moving.
   */
  setDrawing(
    id: ObjectId,
    drawing: WorldBounds | undefined,
  ): { previous: WorldBounds | undefined; next: WorldBounds | undefined } | undefined {
    const index = this.indexById.get(id);
    if (index === undefined) return undefined;
    const previous = this.boxAt(index);
    // Kept relative to the start, as the geometry box is, so later moves carry it along.
    if (drawing === undefined) this.drawing.delete(index);
    else this.drawing.set(index, this.unshifted(index, drawing));
    return { previous, next: this.boxAt(index) };
  }

  /**
   * Whether an object is moving.
   *
   * @param id - The object.
   * @returns True while its session lasts.
   */
  has(id: ObjectId): boolean {
    return this.indexById.has(id);
  }

  /**
   * A moving object's box now.
   *
   * @param id - The object.
   * @returns Its box, or undefined when it is not moving or has none.
   */
  boundsOf(id: ObjectId): WorldBounds | undefined {
    const index = this.indexById.get(id);
    return index === undefined ? undefined : this.boxAt(index);
  }

  /**
   * Every moving box now, with its object.
   *
   * @yields {readonly [ObjectId, WorldBounds]} Each object with a box, and the box.
   */
  *entries(): Generator<readonly [ObjectId, WorldBounds]> {
    for (let index = 0; index < this.ids.length; index += 1) {
      const id = this.ids[index];
      const box = this.boxAt(index);
      if (id !== undefined && box !== undefined) yield [id, box];
    }
  }

  /**
   * Adds the moving objects whose boxes meet a rectangle, edges included.
   *
   * @param rect - The rectangle.
   * @param out - Where the ids go.
   * @returns `out`.
   */
  searchRect(rect: WorldBounds, out: ObjectId[]): ObjectId[] {
    for (let index = 0; index < this.ids.length; index += 1) {
      if (this.meets(index, rect)) {
        const id = this.ids[index];
        if (id !== undefined) out.push(id);
      }
    }
    return out;
  }

  /**
   * Adds the moving objects whose boxes contain a point.
   *
   * @param point - The point.
   * @param out - Where the ids go.
   * @returns `out`.
   */
  searchPoint(point: Point, out: ObjectId[]): ObjectId[] {
    return this.searchRect({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }, out);
  }

  /**
   * The union of every moving box.
   *
   * @returns The box, or undefined when none has one.
   */
  get bounds(): WorldBounds | undefined {
    let union: WorldBounds | undefined;
    for (const [, box] of this.entries()) {
      union =
        union === undefined
          ? box
          : {
              minX: Math.min(union.minX, box.minX),
              minY: Math.min(union.minY, box.minY),
              maxX: Math.max(union.maxX, box.maxX),
              maxY: Math.max(union.maxY, box.maxY),
            };
    }
    return union;
  }

  /** Ends the session: nothing is moving. */
  end(): void {
    this.ids = [];
    this.indexById.clear();
    this.drawing.clear();
    this.indexed = 0;
  }

  private meets(index: number, rect: WorldBounds): boolean {
    return this.meetsShifted(index, rect, this.uniformX, this.uniformY);
  }

  private meetsShifted(index: number, rect: WorldBounds, uniformX: number, uniformY: number) {
    const { base, shift } = this;
    const minX = base[index * 4] ?? Number.NaN;
    if (Number.isNaN(minX)) return false;
    const dx = (shift[index * 2] ?? 0) + uniformX;
    const dy = (shift[index * 2 + 1] ?? 0) + uniformY;
    let left = minX;
    let top = base[index * 4 + 1] ?? 0;
    let right = base[index * 4 + 2] ?? 0;
    let bottom = base[index * 4 + 3] ?? 0;
    const drawing = this.drawing.get(index);
    if (drawing !== undefined) {
      left = Math.min(left, drawing.minX);
      top = Math.min(top, drawing.minY);
      right = Math.max(right, drawing.maxX);
      bottom = Math.max(bottom, drawing.maxY);
    }
    return (
      left + dx <= rect.maxX &&
      rect.minX <= right + dx &&
      top + dy <= rect.maxY &&
      rect.minY <= bottom + dy
    );
  }

  private boxAt(index: number): WorldBounds | undefined {
    const { base, shift } = this;
    const minX = base[index * 4] ?? Number.NaN;
    if (Number.isNaN(minX)) return undefined;
    const dx = (shift[index * 2] ?? 0) + this.uniformX;
    const dy = (shift[index * 2 + 1] ?? 0) + this.uniformY;
    const box = {
      minX: minX + dx,
      minY: (base[index * 4 + 1] ?? 0) + dy,
      maxX: (base[index * 4 + 2] ?? 0) + dx,
      maxY: (base[index * 4 + 3] ?? 0) + dy,
    };
    const drawing = this.drawing.get(index);
    if (drawing === undefined) return box;
    return {
      minX: Math.min(box.minX, drawing.minX + dx),
      minY: Math.min(box.minY, drawing.minY + dy),
      maxX: Math.max(box.maxX, drawing.maxX + dx),
      maxY: Math.max(box.maxY, drawing.maxY + dy),
    };
  }

  private unshifted(index: number, box: WorldBounds): WorldBounds {
    const dx = (this.shift[index * 2] ?? 0) + this.uniformX;
    const dy = (this.shift[index * 2 + 1] ?? 0) + this.uniformY;
    return { minX: box.minX - dx, minY: box.minY - dy, maxX: box.maxX - dx, maxY: box.maxY - dy };
  }

  /** Moves the shared displacement into every object's own, before per-object moves. */
  private foldUniform(): void {
    const { uniformX, uniformY, shift } = this;
    if (uniformX === 0 && uniformY === 0) return;
    for (let index = 0; index < shift.length; index += 2) {
      shift[index] = (shift[index] ?? 0) + uniformX;
      shift[index + 1] = (shift[index + 1] ?? 0) + uniformY;
    }
    this.uniformX = 0;
    this.uniformY = 0;
  }
}
