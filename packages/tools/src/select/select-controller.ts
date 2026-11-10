import type { DocumentStore } from '@canvas/document';
import { visibleWorldBounds, type Camera, type WorldBounds } from '@canvas/engine';
import type { ConnectorDeletePolicy, ObjectId, Point } from '@canvas/schema';

import { activationRoute } from './activation-route.js';
import type { SnapSettings } from './drag-snap.js';
import { EnteredGroupOutline } from './entered-group-outline.js';
import { selectionOnEntering } from './entered-group.js';
import { worldBoundsOfBox, type OrientedBox } from './oriented-box.js';
import type { SelectionOverlayModel } from './overlay-rects.js';
import { readOnlyIntentsOf } from './read-only-intents.js';
import { SelectContext } from './select-context.js';
import type { SelectControllerOptions } from './select-controller-options.js';
import type { SelectCursor } from './select-cursor.js';
import { SelectGesture } from './select-gesture.js';
import type { PointerView, SelectInput } from './select-input.js';
import type { SelectIntent } from './select-intent.js';
import { selectSameTypeOf } from './select-same-type.js';
import {
  IDLE_SELECT_TOOL,
  restingSelectTool,
  stepSelectTool,
  type SelectToolState,
} from './select-tool.js';
import { deleteSelectionObjects, selectAllIdsOf } from './selection-commands.js';
import { SelectionCues } from './selection-cues.js';
import { SelectionFrameCache } from './selection-frame-cache.js';
import { type SelectionSource } from './selection-geometry.js';
import {
  EMPTY_SELECTION,
  isSameSelection,
  selectionOf,
  toggleSelected,
  withoutObjects,
  type SelectionState,
} from './selection-state.js';
import { forwardTouchRequest } from './touch-requests.js';

/**
 * Runs the select tool against a document: feeds input to the pure
 * state machine (`stepSelectTool`) with the current selection and frame, and applies its
 * intents. Selection intents change the selection; a transform drag (`SelectGesture`) is shown
 * as a preview through {@link SelectController.source} (the document with the dragged objects'
 * new state laid over it; the document itself is untouched) and runs on release as exactly one
 * command, so one transaction, one change set and one undo step per gesture; a move outlines the
 * frame it would drop the selection into and, on release, takes each object into the frame under
 * its centre or onto the root in that same command; Escape drops the preview. A
 * nudge, delete and select all act at once. The selection follows the document: objects deleted
 * by anyone leave it. The selection's frame and whether it can be resized are kept between
 * inputs (`SelectionFrameCache`), so a hover (a move with no button down, which only picks the
 * cursor) costs the same whatever the selection's size, and a change set that touches nothing
 * the frame depends on is ignored outright: no recompute, no change callback. The resting
 * cursor is brought up to date when the frame changes, or the camera does, under a still
 * pointer. Main thread; no DOM.
 */
export class SelectController {
  /** The document with the drag preview laid over it: what the scene draws. */
  readonly source: SelectionSource;
  /**
   * What `deleteSelection` does with connectors attached to deleted objects: `detach` (the
   * default) or `delete`, the person's "delete connectors with their objects" preference, which
   * the app sets.
   */
  connectorPolicy: ConnectorDeletePolicy = 'detach';
  private readonly store: DocumentStore;
  private readonly document: SelectionSource;
  private readonly options: SelectControllerOptions;
  private readonly stopListening: () => void;
  private state: SelectToolState = IDLE_SELECT_TOOL;
  private current: SelectionState = EMPTY_SELECTION;
  /** The transform drag: its preview, frame and drop target, and its command on release. */
  private readonly gesture: SelectGesture;
  private readonly context: SelectContext;
  private marquee: WorldBounds | undefined;
  /** The selection's frame on the document and resize flag, kept between inputs. */
  private readonly cache: SelectionFrameCache;
  /** Where the pointer last was, and at what zoom, for the resting cursor. */
  private pointer: PointerView | undefined;
  /** The entered group's box, kept between inputs. */
  private readonly entered: EnteredGroupOutline;
  /** The hover outline, gap runs and labels of the editing states. */
  private readonly cues: SelectionCues;

  /**
   * Starts with nothing selected and listens to the document.
   *
   * @param options - The document, origin, environment, hit tester and change callback.
   */
  constructor(options: SelectControllerOptions) {
    this.options = options;
    this.store = options.store;
    const { isDrawable } = options;
    const children = (id: ObjectId): Iterable<ObjectId> => this.store.references.childrenOf(id);
    const shared = { childrenOf: children, ...(isDrawable && { isDrawable }) };
    this.document = { ...shared, get: (id) => this.store.get(id) };
    this.gesture = new SelectGesture({ ...options, document: this.document });
    this.source = { ...shared, get: (id) => this.gesture.previewOf(id) ?? this.store.get(id) };
    this.cache = new SelectionFrameCache(this.document, options.hasLineEndHandles);
    this.entered = new EnteredGroupOutline(this.document);
    this.context = new SelectContext(() => this.frame(), this.cache, this.document, options);
    const { gesture, cache, source } = this;
    this.cues = new SelectionCues({ hitTester: options.hitTester, gesture, cache, source });
    this.stopListening = this.store.subscribe((changes) => {
      // A drag's caches of the document go stale with any change; O(1) to drop.
      this.gesture.documentChanged();
      this.context.documentChanged();
      // Remote edits arrive hundreds of times a second: one that cannot move the frame or the
      // entered group costs nothing (O(1) per touched id), however large the selection.
      const isSelectionAffected = this.cache.isAffectedBy(changes);
      const isEnteredAffected = this.entered.isAffectedBy(changes);
      if (!isSelectionAffected && !isEnteredAffected) return;
      const { enteredGroupId } = this.state;
      // The entered group was deleted or ungrouped, here or by a collaborator.
      if (enteredGroupId !== null && this.document.get(enteredGroupId)?.type !== 'group') {
        this.setEnteredGroup(null);
      }
      this.setSelection(withoutObjects(this.current, changes.deleted));
      this.restCursor();
      this.notify(isSelectionAffected ? this.gesture.materializeMove() : []);
    });
  }

  /**
   * The selection now.
   *
   * @returns The selection.
   */
  get selection(): SelectionState {
    return this.current;
  }

  /**
   * Whether a press or drag is under way.
   *
   * @returns True between a press and its release, cancel or Escape.
   */
  get isGesturing(): boolean {
    return this.state.phase !== 'idle';
  }

  /**
   * The innermost group entered with a double-click: clicks, marquees and select all
   * act on its children (`enteredScopeIds`). Changes on input, on `enterGroup` and when the
   * group is deleted.
   *
   * @returns The group's id, or null at the board's top level.
   */
  get enteredGroupId(): ObjectId | null {
    return this.state.enteredGroupId;
  }

  /**
   * The cursor the select tool asks for now: `rotate` over a corner's rotation band and through
   * a rotation drag, else `default`. It changes only on input, so the caller reads it after
   * {@link SelectController.handle}.
   *
   * @returns The cursor.
   */
  get cursor(): SelectCursor {
    return this.state.cursor;
  }

  /**
   * Feeds one input to the select tool and applies what it asks for.
   *
   * @param input - The input, normalised by the caller.
   * @param zoom - The camera zoom, CSS px per world unit.
   * @param camera - The camera, whose view keeps the count badge and bounds what
   *   drags snap to; absent, the badge sits below the frame and snapping looks everywhere.
   * @param snapping - The person's snapping preferences; drags do not snap if absent.
   */
  handle(input: SelectInput, zoom: number, camera?: Camera, snapping?: SnapSettings): void {
    const visible = camera && visibleWorldBounds(camera);
    if ('world' in input) {
      this.pointer = { world: input.world, zoom, visible };
      this.gesture.follow(input, zoom, snapping && { settings: snapping, viewport: visible });
    }
    const step = stepSelectTool(
      this.state,
      input,
      this.context.build(this.current, this.state.enteredGroupId, zoom, visible),
    );
    this.state = step.state;
    const isCueChanged = this.cues.follow(input, zoom, this.state, this.current);
    if (this.entered.follow(this.state.enteredGroupId) || isCueChanged) this.notify([]);
    const intents = this.canEdit ? step.intents : readOnlyIntentsOf(step.intents);
    for (const intent of intents) this.apply(intent, zoom);
  }

  /**
   * Whether the person may edit the board now (`SelectControllerOptions.canEdit`):
   * when not, the tool only selects, with no handles, and writes nothing.
   *
   * @returns True unless the option says no.
   */
  get canEdit(): boolean {
    return this.options.canEdit?.() !== false;
  }

  /**
   * Enters a group (a double press on it asks for this through `activate`): clicks and
   * marquees then act on its children, and the object under `world` at its level is selected,
   * or, with no point or nothing of the group's there, its unlocked children. Not mid-drag.
   *
   * @param groupId - The group; nothing happens for anything else.
   * @param world - Where the double press was, world units, if it was one.
   * @param zoom - The camera zoom, for hit testing at the point.
   */
  enterGroup(groupId: ObjectId, world?: Point, zoom = 1): void {
    if (this.state.phase === 'dragging' || this.document.get(groupId)?.type !== 'group') return;
    this.setEnteredGroup(groupId);
    const { hitTester } = this.options;
    const hitAt = world && (() => hitTester.hitPoint(world, zoom, groupId));
    this.select(selectionOnEntering(groupId, this.document, hitAt));
  }

  /**
   * Brings the resting cursor up to date for a pointer that has not moved on screen while the
   * camera did (a wheel zoom, a pan, a fit): the same screen point is a new world point, and
   * the bands' world size follows the zoom. Does nothing mid-gesture.
   *
   * @param world - The pointer's world point under the camera now, world units.
   * @param zoom - The camera zoom now, CSS px per world unit.
   * @param camera - The camera now, whose view keeps the count badge.
   */
  refreshCursor(world: Point, zoom: number, camera?: Camera): void {
    this.pointer = { world, zoom, visible: camera && visibleWorldBounds(camera) };
    this.restCursor();
  }

  /**
   * Selects exactly these ids, as a click or a panel would.
   *
   * @param ids - The ids, first primary.
   */
  select(ids: readonly ObjectId[]): void {
    this.setSelection(selectionOf(ids));
  }

  /**
   * Selects every unlocked object at the board's root, or inside the
   * entered group, its children; not mid-drag.
   */
  selectAll(): void {
    if (this.isGesturing) return;
    this.select(selectAllIdsOf(this.store, this.document, this.state.enteredGroupId));
  }

  /**
   * Select same type: adds every unlocked object of the selection's types in the scope
   * and its frames (`selectSameTypeOf`); no command, so no undo step. Not mid-drag.
   *
   * @param scope - The parent whose children are candidates: the root, or an entered group;
   *   the group entered now (`enteredGroupId`) by default.
   */
  selectSameType(scope: ObjectId | null = this.state.enteredGroupId): void {
    if (this.isGesturing) return;
    this.setSelection(selectSameTypeOf(this.current, this.document, scope));
  }

  /**
   * Deletes the selection's movable objects (not locked ones, nor groups holding a locked
   * object), with their descendants, as one `deleteObjects` command; the selection then
   * drops them. Not mid-drag.
   *
   * @param connectorPolicy - What happens to connectors attached to them: `detach` or
   *   `delete`; default {@link SelectController.connectorPolicy}.
   * @returns The selected groups left alone because they hold a locked object, for the caller
   *   to say why.
   */
  deleteSelection(connectorPolicy = this.connectorPolicy): readonly ObjectId[] {
    if (this.isGesturing) return [];
    const { ids } = this.current;
    return deleteSelectionObjects(this.store, this.options, ids, this.document, connectorPolicy);
  }

  /**
   * The selection frame as shown now: during a drag, the frame the drag has moved, resized or
   * turned; otherwise the selection's frame on the document.
   *
   * @returns The frame, world units, or undefined when nothing is selected.
   */
  frame(): OrientedBox | undefined {
    return this.gesture.frame ?? this.cache.frame();
  }

  /**
   * The world rectangle holding the selection frame, for zoom to selection.
   *
   * @returns The bounds, or undefined when nothing is selected.
   */
  selectionBounds(): WorldBounds | undefined {
    const frame = this.frame();
    return frame && worldBoundsOfBox(frame);
  }

  /**
   * What the selection overlay should show now.
   *
   * @returns The frame, the outlines (or the count above the outline cap: O(1) then, however
   *   large the selection), whether to show resize handles, and the marquee.
   */
  overlay(): SelectionOverlayModel {
    const parts = { frame: this.frame(), selection: this.current, canEdit: this.canEdit };
    return this.cues.overlay({ ...parts, marquee: this.marquee, enteredGroup: this.entered.box() });
  }

  /** Stops listening to the document. */
  destroy(): void {
    this.stopListening();
  }

  /**
   * Sets the entered group outside the state machine's own steps (entering, or the group's
   * deletion), and the outline with it.
   *
   * @param groupId - The innermost entered group, or null.
   */
  private setEnteredGroup(groupId: ObjectId | null): void {
    this.state = { ...this.state, enteredGroupId: groupId };
    if (this.entered.follow(groupId)) this.notify([]);
  }

  /** At rest, recomputes the cursor for the last pointer against the frame as it is now. */
  private restCursor(): void {
    if (this.state.phase !== 'idle' || this.pointer === undefined) return;
    const { world, zoom, visible } = this.pointer;
    this.state = restingSelectTool(
      world,
      this.context.build(this.current, this.state.enteredGroupId, zoom, visible),
      this.state,
    );
  }

  private apply(intent: SelectIntent, zoom: number): void {
    switch (intent.type) {
      case 'activate': {
        const route = activationRoute(intent, this.document, this.state, this.options);
        if (route === 'enter') this.enterGroup(intent.id, intent.world, zoom);
        else if (route === 'zoom') this.options.onDoubleTap?.('selection');
        else this.options.onActivate?.(intent);
        return;
      }
      case 'select':
        this.select(intent.ids);
        return;
      case 'toggle':
        this.setSelection(toggleSelected(this.current, intent.id));
        return;
      case 'marquee':
        this.marquee = intent.rect;
        this.setSelection(selectionOf(intent.ids), true);
        return;
      case 'move':
      case 'resize':
      case 'rotate':
        this.cues.noteTransform();
        this.notify(
          this.gesture.update(intent, this.current, this.cache.frame(), this.cache.scope()),
        );
        return;
      case 'nudge':
        this.gesture.nudge(intent, this.current.ids, this.cache.scope());
        return;
      case 'commit':
      case 'cancel':
        this.endGesture(intent.type === 'commit');
        return;
      default: // `contextMenu`, `doubleTap` and `pan`: requests for the app.
        forwardTouchRequest(intent, this.options);
    }
  }

  /**
   * Ends the gesture: drops the marquee and, through `SelectGesture.end`, runs the drag's one
   * command on commit (its change set touches the moved objects, so the frame cache records their
   * new parents) and drops its preview.
   *
   * @param isCommitted - Whether to run the gesture (release) or drop it (cancel).
   */
  private endGesture(isCommitted: boolean): void {
    this.marquee = undefined;
    // This cache describes the document; its store listener invalidates committed changes.
    this.notify(this.gesture.end(isCommitted, this.current.ids, this.cache.scope()));
    this.restCursor();
  }

  private setSelection(selection: SelectionState, isForced = false): void {
    if (!isForced && isSameSelection(selection, this.current)) return;
    this.current = selection;
    this.cache.select(selection.ids);
    this.cues.selectionChanged();
    this.restCursor();
    this.notify([]);
  }

  private notify(previewIds: readonly ObjectId[]): void {
    this.options.onChange?.(previewIds, this.gesture.movePreview);
  }
}
