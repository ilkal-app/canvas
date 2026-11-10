import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';

import { ADMISSION_RING_COUNT, admissionRing } from './admission-rings.js';
import { containsBounds, intersectsBounds, isSameBounds } from './bounds.js';
import type { SceneSpatialIndex } from './scene-spatial-index.js';

/** A bounded change record; members is borrowed and valid only at the current revision. */
export interface VisibilityChange {
  /** Identity of the provider whose revisions are comparable. */
  readonly source: object;
  /** The current membership revision. */
  readonly revision: number;
  /** The revision from which this delta was computed. */
  readonly previousRevision: number;
  /** Current membership, borrowed until the provider advances. */
  readonly members: ReadonlySet<ObjectId>;
  /** IDs added since the previous revision. */
  readonly entered: readonly ObjectId[];
  /** IDs removed since the previous revision. */
  readonly left: readonly ObjectId[];
}

/** A cap on the membership changes one update makes. */
export interface AdmissionBudget {
  /** The most entries and exits together, a whole number; 0 carries every change. */
  readonly entriesPerFrame: number;
  /**
   * The unpadded view: entries are admitted nearest its centre first, in rings 1/8 of its half
   * size wide (`admissionRing`), those meeting it before those only in the padding.
   */
  readonly viewport: WorldBounds;
}

/**
 * Keeps membership while searching only the strips changed by a moving query. With an
 * {@link AdmissionBudget}, an update applies at most that many changes: carried ones first,
 * oldest first, then entries nearest the viewport's centre first (those meeting the viewport
 * before those only in the padding), and exits. The
 * rest are carried (`pendingCount`): a carried entry is not a member yet and a carried exit still
 * is, and each is checked again at the next update, so one that no longer applies is dropped.
 */
export class SpatialVisibility {
  private readonly members = new Set<ObjectId>();
  /** Membership changes found but not yet applied, in the order they will be. */
  private readonly carried = new Set<ObjectId>();
  private query: WorldBounds | undefined;
  private ids: readonly ObjectId[] | undefined;
  private change: VisibilityChange = {
    source: this,
    revision: 0,
    previousRevision: -1,
    members: this.members,
    entered: [],
    left: [],
  };

  /**
   * Updates membership from query strips and directly changed boxes.
   *
   * @param index - The current spatial index.
   * @param query - The new padded query.
   * @param changed - IDs whose indexed membership may have changed.
   * @param budget - The cap on this update's changes; absent, every change is applied.
   * @returns The retained change record, replaced only when membership changes.
   */
  update(
    index: SceneSpatialIndex,
    query: WorldBounds,
    changed: Iterable<ObjectId>,
    budget?: AdmissionBudget,
  ): VisibilityChange {
    const candidates = new Set(changed);
    for (const strip of this.strips(index, query)) {
      for (const id of index.searchRect(strip)) candidates.add(id);
    }
    const entered: ObjectId[] = [];
    const left: ObjectId[] = [];
    if (budget === undefined && this.carried.size === 0) {
      for (const id of candidates) {
        const bounds = index.boundsOf(id);
        const isVisible = bounds !== undefined && intersectsBounds(bounds, query);
        if (isVisible && !this.members.has(id)) {
          this.members.add(id);
          entered.push(id);
        } else if (!isVisible && this.members.delete(id)) {
          left.push(id);
        }
      }
    } else {
      this.admit(index, query, candidates, budget, entered, left);
    }
    this.query = query;
    if (entered.length || left.length) {
      const previousRevision = this.change.revision;
      this.change = {
        source: this,
        revision: previousRevision + 1,
        previousRevision,
        members: this.members,
        entered,
        left,
      };
      this.ids = undefined;
    }
    return this.change;
  }

  /**
   * How many membership changes a budget carried to the next update.
   *
   * @returns The count; 0 when membership matches the last query.
   */
  get pendingCount(): number {
    return this.carried.size;
  }

  /**
   * Materializes the legacy array only when requested.
   *
   * @returns The array, retained while membership is unchanged.
   */
  toArray(): readonly ObjectId[] {
    this.ids ??= [...this.members];
    return this.ids;
  }

  private admit(
    index: SceneSpatialIndex,
    query: WorldBounds,
    candidates: ReadonlySet<ObjectId>,
    budget: AdmissionBudget | undefined,
    entered: ObjectId[],
    left: ObjectId[],
  ): void {
    const isChange = (id: ObjectId): boolean => {
      const bounds = index.boundsOf(id);
      return (bounds !== undefined && intersectsBounds(bounds, query)) !== this.members.has(id);
    };
    // Admission order: carried, then entries by ring nearest the viewport centre (the viewport's
    // rings before the padding's, `admissionRing`), then exits.
    const carried = [...this.carried].filter(isChange);
    const rings: ObjectId[][] = budget
      ? Array.from({ length: ADMISSION_RING_COUNT }, () => [])
      : [];
    const entries: ObjectId[] = [];
    const exits: ObjectId[] = [];
    for (const id of candidates) {
      if (this.carried.has(id) || !isChange(id)) continue;
      if (this.members.has(id)) exits.push(id);
      else if (!budget) entries.push(id);
      else {
        // An entry is visible, so it has bounds.
        const bounds = index.boundsOf(id) ?? budget.viewport;
        const isInView = intersectsBounds(bounds, budget.viewport);
        rings[admissionRing(bounds, budget.viewport, isInView)]?.push(id);
      }
    }
    this.carried.clear();
    let remaining = budget?.entriesPerFrame ?? Infinity;
    for (const ids of [carried, entries, ...rings, exits]) {
      for (const id of ids) {
        if (remaining <= 0) {
          this.carried.add(id);
        } else if (this.members.delete(id)) {
          left.push(id);
          remaining -= 1;
        } else {
          this.members.add(id);
          entered.push(id);
          remaining -= 1;
        }
      }
    }
  }

  private strips(index: SceneSpatialIndex, query: WorldBounds): readonly WorldBounds[] {
    if (!this.query) return [query];
    if (isSameBounds(this.query, query)) return [];
    const board = index.bounds;
    if (board && containsBounds(this.query, board) && containsBounds(query, board)) return [];
    return [...outside(this.query, query), ...outside(query, this.query)];
  }
}

/**
 * Covers the part of a rectangle outside another; shared edges are harmless candidates.
 *
 * @param box - The rectangle to subtract from.
 * @param other - The rectangle removed.
 * @returns At most four strips, or the whole disjoint rectangle.
 */
function outside(box: WorldBounds, other: WorldBounds): readonly WorldBounds[] {
  if (!intersectsBounds(box, other)) return [box];
  const strips: WorldBounds[] = [];
  if (box.minX < other.minX) strips.push({ ...box, maxX: other.minX });
  if (box.maxX > other.maxX) strips.push({ ...box, minX: other.maxX });
  const minX = Math.max(box.minX, other.minX);
  const maxX = Math.min(box.maxX, other.maxX);
  if (box.minY < other.minY) strips.push({ minX, maxX, minY: box.minY, maxY: other.minY });
  if (box.maxY > other.maxY) strips.push({ minX, maxX, minY: other.maxY, maxY: box.maxY });
  return strips;
}
