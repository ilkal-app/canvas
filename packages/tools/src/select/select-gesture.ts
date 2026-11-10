import type {
  CommandEnvironment,
  CommandError,
  DocumentStore,
  TransactionOrigin,
} from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import type { SnapIndex } from '../snap/snap-candidates.js';
import type { SnapGap } from '../snap/snap-gap.js';
import type { SnapGuide } from '../snap/snap-guide.js';

import { DragDocument } from './drag-document.js';
import type { TransformIntent } from './drag-snap.js';
import { DragSnapper, type SnapView } from './drag-snapper.js';
import { runDropPlan, withDropTargets } from './drop-target.js';
import {
  farSkipOfScope,
  selectionScopeOf,
  type FarSkip,
  type SelectionScope,
} from './far-objects.js';
import { rotateBoxAbout, translateBox, type OrientedBox } from './oriented-box.js';
import { RootMovePreview } from './root-move-preview.js';
import type { SelectHitTester } from './select-hit-tester.js';
import type { SelectPointer } from './select-input.js';
import type { SelectIntent } from './select-intent.js';
import { selectionFrameOf } from './selection-frame.js';
import { type SelectionSource } from './selection-geometry.js';
import type { SelectionState } from './selection-state.js';
import { runStackDrop, type StackSlot } from './stack-reorder.js';
import { planTransform, previewObjects, runTransformPlan } from './transform-plan.js';

export type { TransformIntent } from './drag-snap.js';

/** What a {@link SelectGesture} plans against and writes to. */
export interface SelectGestureOptions {
  /** The document; the gesture writes to it only through its one command, on commit. */
  readonly store: DocumentStore;
  /** The document as the plans read it (not the preview). */
  readonly document: SelectionSource;
  /** Who the gesture's command is attributed to. */
  readonly origin: TransactionOrigin;
  /** The command clock and id generator. */
  readonly environment: CommandEnvironment;
  /** What is under the pointer: the frame a move drops into. */
  readonly hitTester: SelectHitTester;
  /** Called with the errors when the document refuses the gesture's command. */
  readonly onCommandRefused?: (errors: readonly CommandError[]) => void;
  /** Called when the gesture's command skipped selected objects placed far away. */
  readonly onFarSkipped?: (skip: FarSkip) => void;
  /** The index moves and resizes snap against; the grid only if absent. */
  readonly snapIndex?: SnapIndex;
}

/**
 * The transform drag of the select tool, split out of `SelectController`:
 * each move, resize or rotate intent is planned against the document (`planTransform`)
 * and shown as a preview (`previewObjects`: the dragged objects' new state, the document itself
 * untouched), with the frame the drag has moved, resized or turned and, for a move, the frame it
 * would drop the selection into; on commit the last intent is planned again against the document
 * as it is then, with where a move drops each object (`withDropTargets`), and run as
 * exactly one command; on cancel nothing is written. A gesture with nothing movable (a locked
 * selection) previews nothing and keeps no frame of its own. Main thread; no DOM.
 */
export class SelectGesture {
  private readonly options: SelectGestureOptions;
  private preview = new Map<ObjectId, BoardObject>();
  /** Root-leaf preview positions; absent for ordinary transforms or outside a drag. */
  movePreview: RootMovePreview | undefined;
  /** The latest transform intent, re-planned against the document at commit. */
  private transform: TransformIntent | undefined;
  private movedFrame: OrientedBox | undefined;
  private target: OrientedBox | undefined;
  /** During a move inside a live auto-layout, the slot the boxes would take. */
  private slot: StackSlot | undefined;
  /** The document as the drop rules read it, its children cached. */
  private readonly dropSource: DragDocument;
  private readonly snapper: DragSnapper;
  /**
   * What the drag snaps, worked out at its first step: the objects that move (not locked ones)
   * and their frame.
   */
  private snapScope:
    { readonly ids: readonly ObjectId[]; readonly start: OrientedBox | undefined } | undefined;

  /**
   * Starts with no drag under way.
   *
   * @param options - The document, origin, environment, hit tester and refusal callback.
   */
  constructor(options: SelectGestureOptions) {
    this.options = options;
    this.snapper = new DragSnapper(options.snapIndex, options.document);
    this.dropSource = new DragDocument(options.document);
  }

  /** Drops the drag's caches of the document, which changed under it. */
  documentChanged(): void {
    this.snapper.documentChanged();
    this.dropSource.clear();
  }

  /**
   * During a snapped drag, the guides through the lines it snapped to.
   *
   * @returns The guides; empty outside a snapped drag.
   */
  get guides(): readonly SnapGuide[] {
    return this.snapper.guides;
  }

  /**
   * During a drag snapped to an object, the runs to the selection's nearest facing neighbours.
   *
   * @returns The runs; empty otherwise.
   */
  get gaps(): readonly SnapGap[] {
    return this.snapper.gaps;
  }

  /**
   * Takes a pointer input's snap modifier, zoom and view (the person's snapping preferences and
   * the viewport) for the drag steps it produces.
   *
   * @param pointer - The input.
   * @param zoom - The camera zoom, CSS px per world unit.
   * @param view - The preferences and viewport; no snapping if absent.
   */
  follow(pointer: SelectPointer, zoom: number, view: SnapView | undefined): void {
    this.snapper.follow(pointer, zoom, view);
  }

  /**
   * The selection frame as the drag has moved, resized or turned it.
   *
   * @returns The frame, world units, or undefined outside a drag or when nothing moves.
   */
  get frame(): OrientedBox | undefined {
    return this.movedFrame;
  }

  /**
   * During a resize, the frame as resized: what the size readout measures.
   *
   * @returns The frame, world units, or undefined outside a resize or when nothing resizes.
   */
  get resizedFrame(): OrientedBox | undefined {
    return this.transform?.type === 'resize' ? this.movedFrame : undefined;
  }

  /**
   * During a move, the frame the primary object would land in on release.
   *
   * @returns The frame's box, world units, or undefined over bare board and outside a move.
   */
  get dropTarget(): OrientedBox | undefined {
    return this.target;
  }

  /**
   * During a move of boxes inside, or into, a frame or main with a live auto-layout, the
   * line across its stack where they would go on release; undefined otherwise.
   *
   * @returns The line, a box of no width or no height, world units.
   */
  get insertion(): OrientedBox | undefined {
    return this.slot?.line;
  }

  /**
   * Whether a drag preview is laid over the document: while it is, boxes measured on the
   * previewed document change with every step.
   *
   * @returns True during a previewed drag.
   */
  get hasPreview(): boolean {
    return this.movePreview !== undefined || this.preview.size > 0;
  }

  /**
   * An object as the drag shows it.
   *
   * @param id - The object.
   * @returns Its previewed state, or undefined when the drag does not change it.
   */
  previewOf(id: ObjectId): BoardObject | undefined {
    return this.movePreview?.get(id) ?? this.preview.get(id);
  }

  /**
   * Leaves the retained path before document changes invalidate its base geometry. Keeps the
   * existing preview until the next pointer update, just as an ordinary preview does.
   *
   * @returns The members whose retained placement must become ordinary objects.
   */
  materializeMove(): readonly ObjectId[] {
    const move = this.movePreview;
    if (!move) return [];
    for (const id of move.ids) {
      const object = move.get(id);
      if (object) this.preview.set(id, object);
    }
    this.movePreview = undefined;
    return move.ids;
  }

  /**
   * Shows a transform intent: snaps it (moves and resizes, `snapTransform`), plans it
   * for the selection, previews the objects it changes and moves the frame with them. The
   * snapped intent is the one committed on release.
   *
   * @param raw - The move, resize or rotate, as the pointer made it.
   * @param selection - The selection.
   * @param startFrame - The selection's frame on the document, where a move starts from.
   * @param selectionScope - The selection's near and far objects (`SelectionScope`), worked out
   *   once and kept by the caller, so a pointer move does not test them again; worked
   *   out here when omitted.
   * @returns The ids whose preview changed.
   */
  update(
    raw: TransformIntent,
    selection: SelectionState,
    startFrame: OrientedBox | undefined,
    selectionScope: SelectionScope = selectionScopeOf(selection.ids, this.options.document),
  ): ObjectId[] {
    const { document, hitTester } = this.options;
    const scope = this.snapScopeOf(selection, startFrame, selectionScope);
    // Nothing movable (a locked selection): nothing snaps and no guide shows.
    const intent = scope.ids.length > 0 ? this.snapper.snap(raw, scope.ids, scope.start) : raw;
    this.transform = intent;
    const plan = planTransform(intent, selection.ids, document, selectionScope.near);
    // Nothing movable (a locked selection): the frame stays where the objects do.
    if (!plan) this.movedFrame = undefined;
    else if (intent.type === 'resize') this.movedFrame = intent.to;
    else if (intent.type === 'rotate') {
      this.movedFrame = rotateBoxAbout(intent.from, intent.pivot, intent.angle);
    } else this.movedFrame = startFrame && translateBox(startFrame, intent.delta);
    const drops = plan?.kind === 'move' ? this.dropSource.dropsOf(plan, selection, hitTester) : {};
    this.target = drops.target;
    this.slot = drops.slot;
    if (plan?.kind === 'move') {
      const previous = this.movePreview;
      const retained =
        plan.ids.length === previous?.ids.length &&
        plan.ids.every(
          (id, index) => id === previous.ids[index] && document.get(id) === previous.objects[index],
        )
          ? previous
          : RootMovePreview.create(plan.ids, document);
      if (retained) {
        const changed =
          retained === previous && this.preview.size === 0
            ? [...retained.ids]
            : [...new Set([...this.preview.keys(), ...(previous?.ids ?? []), ...retained.ids])];
        this.preview.clear();
        this.movePreview = retained.move(plan.delta);
        return changed;
      }
    }
    const previous = this.movePreview;
    if (
      !plan &&
      intent.type === 'move' &&
      intent.delta.x === 0 &&
      intent.delta.y === 0 &&
      selectionScope.near.length === previous?.ids.length &&
      selectionScope.near.every(
        (id, index) => id === previous.ids[index] && document.get(id) === previous.objects[index],
      )
    ) {
      this.movePreview = previous.rest();
      return [...previous.ids];
    }
    return this.setPreview(plan ? previewObjects(plan, document) : []);
  }

  /**
   * Ends the drag: on commit, plans its last intent again against the document as it is now, so
   * objects a collaborator deleted or locked since the last move are left out instead of making
   * the command refuse the whole gesture, adds where a move drops each object (a frame under its
   * centre, or the root), and runs that plan as the gesture's one command, the reparents
   * included; then drops the preview.
   *
   * @param isCommitted - Whether to run the gesture (release) or drop it (cancel).
   * @param ids - The selected ids.
   * @param selectionScope - The selection's near and far objects on the document as it is now;
   *   worked out here when omitted.
   * @returns The ids whose preview was dropped.
   */
  end(
    isCommitted: boolean,
    ids: readonly ObjectId[],
    selectionScope: SelectionScope = selectionScopeOf(ids, this.options.document),
  ): ObjectId[] {
    const { transform, slot } = this;
    this.transform = undefined;
    this.movedFrame = undefined;
    this.target = undefined;
    this.slot = undefined;
    this.snapper.clear();
    this.dropSource.clear();
    this.snapScope = undefined;
    const { store, document, origin, environment, hitTester } = this.options;
    const planned =
      isCommitted && transform
        ? planTransform(transform, ids, document, selectionScope.near)
        : undefined;
    // Boxes moved within, or into, a live auto-layout take the slot shown, not the place the
    // pointer left them, which the relayout would undo.
    const stacked =
      planned?.kind === 'move' && slot
        ? runStackDrop(store, origin, environment, document, planned.ids, slot)
        : undefined;
    // A refused stack drop (a locked container, say) wrote nothing: the drag still runs as the
    // move it would have been, as a refused drop does (`runDropPlan`), and the refusal is told.
    const dropped =
      planned && (stacked === undefined || stacked.length > 0)
        ? runDropPlan(store, origin, environment, withDropTargets(planned, document, hitTester))
        : [];
    const refused = stacked !== undefined && stacked.length > 0 ? stacked : dropped;
    // One notice: a refusal, or else what the transform skipped.
    if (refused.length > 0) this.options.onCommandRefused?.(refused);
    else if (isCommitted && transform) this.reportSkip(selectionScope);
    return this.setPreview([]);
  }

  /**
   * Runs an arrow-key move as its one command, at once (no drag, no preview), and reports what it
   * skipped because the objects are placed far away.
   *
   * @param intent - The nudge.
   * @param ids - The selected ids.
   * @param selectionScope - The selection's near and far objects; worked out here when omitted.
   */
  nudge(
    intent: SelectIntent & { readonly type: 'nudge' },
    ids: readonly ObjectId[],
    selectionScope: SelectionScope = selectionScopeOf(ids, this.options.document),
  ): void {
    const { store, document, origin, environment } = this.options;
    const plan = planTransform(intent, ids, document, selectionScope.near);
    if (plan) runTransformPlan(store, origin, environment, plan);
    this.reportSkip(selectionScope);
  }

  /**
   * Tells the caller what a transform skipped because the objects are far, if anything.
   *
   * @param selectionScope - The selection's near and far objects.
   */
  private reportSkip(selectionScope: SelectionScope): void {
    const skip = farSkipOfScope(selectionScope);
    if (skip) this.options.onFarSkipped?.(skip);
  }

  /**
   * The objects a drag snaps and their frame, worked out once per gesture: the selection's
   * movable objects (`transformableIds`), and their own frame when locked ones are left out.
   *
   * @param selection - The selection.
   * @param startFrame - The whole selection's frame.
   * @param selectionScope - The selection's near and far objects.
   * @returns The scope.
   */
  private snapScopeOf(
    selection: SelectionState,
    startFrame: OrientedBox | undefined,
    selectionScope: SelectionScope,
  ): { readonly ids: readonly ObjectId[]; readonly start: OrientedBox | undefined } {
    if (this.snapScope) return this.snapScope;
    const { document } = this.options;
    const ids = selectionScope.near;
    const isWhole = ids.length === selection.ids.length;
    this.snapScope = {
      ids,
      start: isWhole ? startFrame : selectionFrameOf(ids, document, selectionScope.far),
    };
    return this.snapScope;
  }

  /**
   * Replaces the preview.
   *
   * @param objects - The previewed objects.
   * @returns The ids previewed before or now.
   */
  private setPreview(objects: readonly BoardObject[]): ObjectId[] {
    const changed = new Set([
      ...this.preview.keys(),
      ...(this.movePreview?.ids ?? []),
      ...objects.map((object) => object.id),
    ]);
    this.movePreview = undefined;
    this.preview = new Map(objects.map((object) => [object.id, object]));
    return [...changed];
  }
}
