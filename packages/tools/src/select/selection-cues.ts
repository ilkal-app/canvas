import type { WorldBounds } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import type { OrientedBox } from './oriented-box.js';
import { gapLabelsOf, lockedLabelOf, sizeLabelOf, type OverlayLabel } from './overlay-label.js';
import type { SelectionOverlayModel } from './overlay-rects.js';
import type { SelectGesture } from './select-gesture.js';
import type { SelectHitTester } from './select-hit-tester.js';
import type { SelectInput } from './select-input.js';
import type { SelectToolState } from './select-tool-state.js';
import type { SelectionFrameCache } from './selection-frame-cache.js';
import { selectionBoxOf } from './selection-frame.js';
import type { SelectionSource } from './selection-geometry.js';
import { selectionOutlinesOf, type SelectionOutlines } from './selection-outlines.js';
import type { SelectionState } from './selection-state.js';

/** What {@link SelectionCues} reads. */
export interface SelectionCueSources {
  /** What is under a resting pointer. */
  readonly hitTester: SelectHitTester;
  /** The document with the drag preview over it: what boxes are measured on. */
  readonly source: SelectionSource;
  /** The transform drag: its guides, gap runs and resized frame. */
  readonly gesture: SelectGesture;
  /** The selection's frame cache: whether it can be resized, whether it is locked. */
  readonly cache: SelectionFrameCache;
}

/** The select tool's state the overlay model is made of, besides what the cues keep. */
export interface SelectionOverlayParts {
  /** The selection frame as shown. */
  readonly frame: OrientedBox | undefined;
  /** The selection. */
  readonly selection: SelectionState;
  /** Whether the person may edit: no handles otherwise. */
  readonly canEdit: boolean;
  /** The marquee being dragged. */
  readonly marquee: WorldBounds | undefined;
  /** The entered group's box. */
  readonly enteredGroup: OrientedBox | undefined;
}

/**
 * The select tool's editing cues (Figma "States" E2) and the overlay model they join:
 * the outline of the object under a resting mouse or pen that is not selected (one hit test per
 * resting move; the model changes only when the hovered object does), the gap runs and their
 * lengths during a snapped drag, the size readout during a resize, and "Locked · can't move or
 * resize" once a person tries to move, resize or turn a locked selection, until the selection
 * changes or the next press. Main thread; no DOM.
 */
export class SelectionCues {
  private readonly sources: SelectionCueSources;
  private hoverId: ObjectId | undefined;
  private isRefused = false;
  /**
   * The selection's ids as a set, for the hover's membership test, and the array it was made
   * from: rebuilt only when the selection changes, so a resting move costs O(1) whatever the
   * selection's size.
   */
  private members:
    { readonly ids: readonly ObjectId[]; readonly set: ReadonlySet<ObjectId> } | undefined;
  /**
   * The selection's outlines as last made, for the selection and frame cache revision they were
   * made at, outside a drag: a hover change makes only the hover outline.
   */
  private outlines:
    | {
        readonly ids: readonly ObjectId[];
        readonly revision: number;
        readonly outlines: SelectionOutlines;
      }
    | undefined;

  /**
   * Starts with nothing hovered and no notice.
   *
   * @param sources - The hit tester, the previewed document, the gesture and the frame cache.
   */
  constructor(sources: SelectionCueSources) {
    this.sources = sources;
  }

  /**
   * Follows an input: a resting mouse or pen move with the default cursor finds the object under
   * it (not one already selected); a press drops the hover and the locked notice; any other
   * pointer input drops the hover.
   *
   * @param input - The input.
   * @param zoom - The camera zoom, CSS px per world unit.
   * @param state - The select tool after the input: whether it rests with the default cursor
   *   (not over a rotation band), and the entered group, whose children are picked at its level.
   * @param selection - The selection.
   * @returns Whether what the cues show changed.
   */
  follow(
    input: SelectInput,
    zoom: number,
    state: Pick<SelectToolState, 'phase' | 'enteredGroupId' | 'cursor'>,
    selection: SelectionState,
  ): boolean {
    if (!('world' in input)) return false;
    const wasRefused = this.isRefused;
    if (input.kind === 'pointerDown') this.isRefused = false;
    let hovered: ObjectId | undefined;
    // Over the selection's rotation bands a press turns the selection: nothing else is hovered.
    const isResting = state.phase === 'idle' && state.cursor === 'default';
    if (isResting && input.kind === 'pointerMove' && input.pointerType !== 'touch') {
      const hit = this.sources.hitTester.hitPoint(input.world, zoom, state.enteredGroupId);
      const id = hit?.part === 'background' ? undefined : hit?.id;
      hovered = id !== undefined && !this.membersOf(selection.ids).has(id) ? id : undefined;
    }
    const isChanged = hovered !== this.hoverId || wasRefused !== this.isRefused;
    this.hoverId = hovered;
    return isChanged;
  }

  /**
   * The selection as a set, made once per selection (its ids array is the same until it changes).
   *
   * @param ids - The selected ids.
   * @returns The set.
   */
  private membersOf(ids: readonly ObjectId[]): ReadonlySet<ObjectId> {
    if (this.members?.ids !== ids) this.members = { ids, set: new Set(ids) };
    return this.members.set;
  }

  /**
   * Notes a move, resize or rotation step: on a locked selection it is refused, and the notice
   * shows.
   *
   * @returns Whether the notice just appeared.
   */
  noteTransform(): boolean {
    if (this.isRefused || !this.sources.cache.isLocked()) return false;
    this.isRefused = true;
    return true;
  }

  /** The selection changed: the locked notice, about the old one, goes. */
  selectionChanged(): void {
    this.isRefused = false;
    this.hoverId = undefined;
  }

  /**
   * The overlay model: the frame, outlines (or count), handles, lock and marquee, drop target,
   * entered group, guides and gap runs, the hover outline and the labels.
   *
   * @param parts - The select tool's state.
   * @returns The model.
   */
  overlay(parts: SelectionOverlayParts): SelectionOverlayModel {
    const { gesture, cache, source } = this.sources;
    const { frame, selection } = parts;
    const hover = this.hoverId === undefined ? undefined : selectionBoxOf(this.hoverId, source);
    const labels = this.labelsOf(frame);
    const { guides, gaps } = gesture;
    return {
      frame,
      ...this.outlinesOf(selection.ids),
      canResize: parts.canEdit && cache.canResize(),
      isLocked: cache.isLocked(),
      marquee: parts.marquee,
      dropTarget: gesture.dropTarget,
      ...(gesture.insertion === undefined ? {} : { insertion: gesture.insertion }),
      enteredGroup: parts.enteredGroup,
      toolRects: [],
      ...(guides.length > 0 ? { guides } : {}),
      ...(gaps.length > 0 ? { gaps } : {}),
      ...(hover === undefined ? {} : { hover }),
      ...(labels.length > 0 ? { labels } : {}),
    };
  }

  /**
   * The selection's outlines: made again only when the selection, or what its boxes depend on,
   * changed, or while a drag preview moves them.
   *
   * @param ids - The selected ids.
   * @returns The outlines, or the count.
   */
  private outlinesOf(ids: readonly ObjectId[]): SelectionOutlines {
    const { gesture, cache, source } = this.sources;
    const make = () => selectionOutlinesOf(ids, (id) => selectionBoxOf(id, source));
    if (gesture.hasPreview) {
      this.outlines = undefined;
      return make();
    }
    const kept = this.outlines;
    if (kept?.ids === ids && kept.revision === cache.revision) return kept.outlines;
    const outlines = make();
    this.outlines = { ids, revision: cache.revision, outlines };
    return outlines;
  }

  /**
   * The labels: the size readout of a resize, the gap runs' lengths, the locked notice.
   *
   * @param frame - The selection frame as shown.
   * @returns The labels.
   */
  private labelsOf(frame: OrientedBox | undefined): OverlayLabel[] {
    const { gesture } = this.sources;
    const resized = gesture.resizedFrame;
    const labels = gapLabelsOf(gesture.gaps);
    if (resized !== undefined) labels.push(sizeLabelOf(resized));
    if (this.isRefused && frame !== undefined) labels.push(lockedLabelOf(frame));
    return labels;
  }
}
