import type { WorldBounds } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import type { SnapIndex } from '../snap/snap-candidates.js';
import type { SnapGap } from '../snap/snap-gap.js';
import type { SnapGuide } from '../snap/snap-guide.js';

import type { SnapSettings, TransformIntent } from './drag-snap.js';
import type { OrientedBox } from './oriented-box.js';
import type { SelectPointer } from './select-input.js';
import type { SelectionSource } from './selection-geometry.js';
import { snapTransform } from './snap-transform.js';

/** How the select tool snaps at one input: the person's preferences and what is on screen. */
export interface SnapView {
  /** Whether snapping is on and whether the grid shows (per user). */
  readonly settings: SnapSettings;
  /** What is on screen, world units: drags snap only to objects in it; everywhere if absent. */
  readonly viewport?: WorldBounds | undefined;
}

const NO_GUIDES: readonly SnapGuide[] = Object.freeze([]);
const NO_GAPS: readonly SnapGap[] = Object.freeze([]);

/**
 * The select controller's snapping: it follows
 * each pointer input's snap modifier, zoom and view, snaps the drag's intents (`snapTransform`)
 * and keeps the guides and gap runs the last one produced, for the overlay. Main thread; no DOM.
 */
export class DragSnapper {
  private readonly index: SnapIndex | undefined;
  private readonly source: SelectionSource;
  private isSuspended = false;
  private zoom = 1;
  private view: SnapView | undefined;
  private shown: readonly SnapGuide[] = NO_GUIDES;
  private shownGaps: readonly SnapGap[] = NO_GAPS;
  /**
   * The gesture's candidates' boxes: neighbours do not move while one drags, so each is worked
   * out once per gesture (an edit a collaborator makes to one mid-drag shows from the next).
   */
  private readonly boxes = new Map<ObjectId, WorldBounds | null>();
  /** The gesture's dragged ids, and the same as a set, built once per gesture. */
  private moving:
    { readonly ids: readonly ObjectId[]; readonly set: ReadonlySet<ObjectId> } | undefined;

  /**
   * Snaps against an index over a document.
   *
   * @param index - The spatial index candidates come from; the grid only if absent.
   * @param source - The document, without the drag preview.
   */
  constructor(index: SnapIndex | undefined, source: SelectionSource) {
    this.index = index;
    this.source = source;
  }

  /**
   * The guides of the drag step last snapped.
   *
   * @returns The guides; empty outside a snapped drag.
   */
  get guides(): readonly SnapGuide[] {
    return this.shown;
  }

  /**
   * The gap runs of the drag step last snapped, when it snapped to an object.
   *
   * @returns The runs; empty outside a drag snapped to an object.
   */
  get gaps(): readonly SnapGap[] {
    return this.shownGaps;
  }

  /**
   * Takes a pointer input's snap modifier, zoom and view for the drag steps it produces.
   *
   * @param pointer - The input.
   * @param zoom - The camera zoom, CSS px per world unit.
   * @param view - The preferences and viewport; no snapping if absent.
   */
  follow(pointer: SelectPointer, zoom: number, view: SnapView | undefined): void {
    this.isSuspended = pointer.isSnapSuspended ?? false;
    this.zoom = zoom;
    this.view = view;
  }

  /**
   * Snaps a drag step and keeps its guides.
   *
   * @param intent - The step's intent, measured from the press.
   * @param movingIds - The dragged selection.
   * @param start - The selection frame when the drag began.
   * @returns The intent to preview and commit.
   */
  snap(
    intent: TransformIntent,
    movingIds: readonly ObjectId[],
    start: OrientedBox | undefined,
  ): TransformIntent {
    const { view } = this;
    if (view === undefined) {
      this.shown = NO_GUIDES;
      this.shownGaps = NO_GAPS;
      return intent;
    }
    const snapped = snapTransform(intent, {
      settings: view.settings,
      viewport: view.viewport,
      isSuspended: this.isSuspended,
      index: this.index,
      source: this.source,
      movingIds: this.movingSetOf(movingIds),
      start,
      zoom: this.zoom,
      boxes: this.boxes,
    });
    this.shown = snapped.guides.length > 0 ? snapped.guides : NO_GUIDES;
    this.shownGaps = snapped.gaps !== undefined && snapped.gaps.length > 0 ? snapped.gaps : NO_GAPS;
    return snapped.intent;
  }

  /**
   * The dragged ids as a set, rebuilt only when the gesture hands over another list.
   *
   * @param ids - The dragged ids.
   * @returns The set.
   */
  private movingSetOf(ids: readonly ObjectId[]): ReadonlySet<ObjectId> {
    if (this.moving?.ids !== ids) this.moving = { ids, set: new Set(ids) };
    return this.moving.set;
  }

  /**
   * Drops the boxes the drag cached of the document: something changed under it, here or from a
   * collaborator, so a neighbour a peer moved snaps where it is now.
   */
  documentChanged(): void {
    this.boxes.clear();
  }

  /** Drops the guides, the gap runs and the gesture's boxes: the drag ended. */
  clear(): void {
    this.moving = undefined;
    this.shown = NO_GUIDES;
    this.shownGaps = NO_GAPS;
    this.boxes.clear();
  }
}
