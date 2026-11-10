import type { Camera, PathNetwork } from '@canvas/engine';
import type { ObjectId, Point } from '@canvas/schema';

import type { ScreenPoint } from '../camera/camera-moves.js';
import type { ToolId } from '../modes/tool-ids.js';
import {
  type ToolCursor,
  type ToolKeyInput,
  type ToolMode,
  type ToolPointerInput,
  type ToolStep,
} from '../modes/tool-mode.js';
import type { SelectionOverlayModel } from '../select/overlay-rects.js';
import type { SelectPointer } from '../select/select-input.js';

import { setHandle, toggleSmooth } from './network-handles.js';
import {
  hitFill,
  hitNetworkHandle,
  hitSegment,
  hitVertex,
  HANDLE_HIT_TOLERANCE_PX,
  SEGMENT_HIT_TOLERANCE_PX,
  VERTEX_HIT_TOLERANCE_PX,
  type HandleHit,
} from './network-hit.js';
import { deleteAndHeal, deleteVertices, moveVertices } from './network.js';
import { PATH_LOCKED_NOTICE, PathSession } from './path-session.js';
import { isAltHeld, type PenModeContext } from './pen-context.js';
import { PEN_DRAG_DEAD_ZONE_PX } from './pen-mode.js';
import { VectorEditView } from './vector-edit-view.js';

/** Builds the pen sub-tool of vector editing on a path (`createPenMode` with `edit`). */
export type PenFactory = (id: ObjectId) => ToolMode;

/** How far a curve may stray from its polyline when the fill is hit tested, CSS px. */
const FILL_TOLERANCE_PX = 0.25;

/**
 * A step that keeps the mode active and that the mode has shown itself: it signals a change
 * only when what it shows changed, so the router does not rebuild the overlay after every
 * pointer move.
 */
const SHOWN_STEP: ToolStep = Object.freeze({ isDone: false, isShown: true });

/** A drag under way: the selected vertices, or one handle. */
interface EditPress {
  /** The network before the press. */
  readonly base: PathNetwork;
  /** The network the drag leaves now. */
  network: PathNetwork;
  /** What the drag moves. */
  readonly target: { readonly kind: 'vertices' } | ({ readonly kind: 'handle' } & HandleHit);
  /** Where the press landed, local units. */
  readonly start: Point;
  /** Where it landed, CSS px: a drag starts past the dead zone. */
  readonly screen: ScreenPoint;
  /** Whether the press has left the dead zone. */
  isDragging: boolean;
}

/**
 * Vector editing's move sub-tool (the prototype's `VectorEditMode`, webgl-whiteboard
 * `src/app/modes/vectorEditMode.ts`), entered by activating a path (a double-click, or Enter with
 * it selected): a click selects a vertex (Shift toggles it in a multi-selection), a drag moves the
 * selected vertices, a drag on a segment moves its two vertices, a selected vertex shows its
 * handles and a handle drag reshapes with the vertex's mirror (Alt breaks it); Alt-click toggles a
 * vertex between corner and smooth; Delete removes the selected vertices and their segments,
 * Shift+Delete heals the gaps (a path left with no segment is deleted). A click inside the fill
 * clears the vertex selection; a click off the path, Enter or Escape leave editing, the path
 * staying selected. The toolbar shows the select tool, whose key V this is; P switches to the pen
 * sub-tool on the same path. Each gesture is one `editNetwork`, previewed while it drags. The
 * overlay draws every segment as a thin line, the one under the pointer thicker, so a path with no
 * stroke and no fill shows too; the cursor is a pointer over a vertex or handle and `move` over a
 * segment or while dragging (the prototype's `cursor`). The hover and the overlay's skeleton are
 * kept in a `VectorEditView`, so a pointer move that changes nothing costs a culled hit test and no
 * overlay rebuild. Main thread; no DOM.
 */
export class VectorEditMode implements ToolMode {
  readonly id = 'select' as const;
  private readonly context: PenModeContext;
  private readonly makePen: PenFactory | undefined;
  private readonly session: PathSession;
  private readonly pathId: ObjectId;
  private selected = new Set<string>();
  private press: EditPress | undefined;
  private readonly view = new VectorEditView();
  private isExited = false;

  /**
   * Starts editing a path; it becomes the selection.
   *
   * @param context - The document and the callbacks.
   * @param id - The path.
   * @param makePen - Builds the pen sub-tool P switches to; P ends editing when absent.
   */
  constructor(context: PenModeContext, id: ObjectId, makePen?: PenFactory) {
    this.context = context;
    this.makePen = makePen;
    this.pathId = id;
    this.session = new PathSession(context, id);
    context.selectObjects([id]);
  }

  /**
   * The selected vertices.
   *
   * @returns Their ids.
   */
  get selectedVertices(): ReadonlySet<string> {
    return this.selected;
  }

  /**
   * The cursor: `move` while a drag is under way, else the one over what the pointer is on.
   *
   * @returns The cursor.
   */
  get cursor(): ToolCursor {
    return this.press?.isDragging === true ? 'move' : this.view.hoverCursor;
  }

  onPointer(input: ToolPointerInput): ToolStep {
    if (input.kind === 'pointerCancel') {
      this.cancelPress();
      return SHOWN_STEP;
    }
    if (input.kind === 'contextPress' || input.kind === 'hold') return SHOWN_STEP;
    if (this.view.follow(input.zoom, input.camera)) this.context.onChange();
    switch (input.kind) {
      case 'pointerDown':
        return this.onPress(input);
      case 'pointerMove':
        this.onDrag(input);
        return SHOWN_STEP;
      case 'pointerUp':
        this.onRelease();
        return SHOWN_STEP;
    }
  }

  onKey(input: ToolKeyInput): boolean {
    switch (input.kind) {
      case 'escape':
      case 'enter':
        this.context.requestExit();
        return true;
      case 'delete':
        this.deleteSelected(input.isHealing === true);
        return true;
      case 'selectAll':
      case 'nudge':
        return false;
    }
  }

  overlay(): Partial<SelectionOverlayModel> {
    return {
      frame: undefined,
      outlines: [],
      canResize: false,
      toolRects: this.view.rects(
        this.press?.network ?? this.session.network(),
        this.session.frame(),
        this.selected,
        this.press !== undefined,
      ),
    };
  }

  onZoom(zoom: number): void {
    if (this.view.follow(zoom, undefined)) this.context.onChange();
  }

  refreshCursor(world: Point, camera: Camera): void {
    const isStale = this.view.follow(camera.zoom, camera);
    const path = this.press === undefined ? this.session.path() : undefined;
    const point = this.session.toLocal(world);
    const isHoverChanged = path !== undefined && this.view.hover(path, this.selected, point);
    if (isStale || isHoverChanged) this.context.onChange();
  }

  onToolSwitch(tool: ToolId): ToolMode | undefined {
    if (tool !== 'pen' || !this.makePen || this.session.path() === undefined) return undefined;
    this.cancelPress();
    return this.makePen(this.pathId);
  }

  exit(): void {
    if (this.isExited) return;
    this.isExited = true;
    this.cancelPress();
    const kept = this.session.finish();
    if (kept !== undefined) this.context.selectObjects([kept]);
  }

  abandon(): void {
    if (this.isExited) return;
    this.isExited = true;
    this.cancelPress();
    this.session.abandon();
  }

  /**
   * A press: a handle of a selected vertex, then a vertex, then a segment; inside the fill (a
   * path with a fill) it clears the vertex selection; anywhere else it leaves editing.
   *
   * @param input - The press.
   * @returns Whether editing ended.
   */
  private onPress(input: SelectPointer): ToolStep {
    this.cancelPress();
    const path = this.session.path();
    if (path === undefined) return { isDone: true };
    if (path.locked) {
      this.context.onNotice?.(PATH_LOCKED_NOTICE);
      return { isDone: true };
    }
    const pixel = 1 / this.view.zoom;
    const network: PathNetwork = path;
    const point = this.session.toLocal(input.world);
    const start = { base: network, network, start: point, screen: input.screen, isDragging: false };
    const handle = hitNetworkHandle(network, this.selected, point, HANDLE_HIT_TOLERANCE_PX * pixel);
    if (handle) {
      this.press = { ...start, target: { kind: 'handle', ...handle } };
      return SHOWN_STEP;
    }
    const vertexId = hitVertex(network, point, VERTEX_HIT_TOLERANCE_PX * pixel);
    if (vertexId !== undefined) {
      this.pressVertex(network, vertexId, input);
      if (this.selected.has(vertexId) && !isAltHeld(input)) {
        this.press = { ...start, target: { kind: 'vertices' } };
      }
      return SHOWN_STEP;
    }
    const segment = hitSegment(network, point, SEGMENT_HIT_TOLERANCE_PX * pixel);
    const hit = segment && network.segments.find(({ id }) => id === segment.segmentId);
    if (hit) {
      this.selected = new Set([hit.a, hit.b]);
      this.press = { ...start, target: { kind: 'vertices' } };
      this.context.onChange();
      return SHOWN_STEP;
    }
    // Only a painted fill is part of the path: inside an unfilled loop is off it.
    if (path.fill !== null && hitFill(network, point, FILL_TOLERANCE_PX * pixel)) {
      this.selected = new Set();
      this.context.onChange();
      return SHOWN_STEP;
    }
    return { isDone: true };
  }

  /**
   * A press on a vertex: Alt toggles it between corner and smooth (one command) and selects it;
   * Shift toggles it in the selection; a plain press selects it alone unless it is selected.
   *
   * @param network - The network.
   * @param vertexId - The vertex.
   * @param input - The press.
   */
  private pressVertex(network: PathNetwork, vertexId: string, input: SelectPointer): void {
    if (isAltHeld(input)) {
      // Alt, the snap modifier, toggles corner and smooth here.
      this.selected = new Set([vertexId]);
      this.write(network, toggleSmooth(network, vertexId));
    } else if (input.isShiftPressed) {
      const next = new Set(this.selected);
      if (next.has(vertexId)) next.delete(vertexId);
      else next.add(vertexId);
      this.selected = next;
    } else if (!this.selected.has(vertexId)) {
      this.selected = new Set([vertexId]);
    }
    this.context.onChange();
  }

  /**
   * A drag past the dead zone: the selected vertices follow the pointer, or the handle does
   * (Alt breaks its mirror).
   *
   * @param input - The pointer.
   */
  private onDrag(input: SelectPointer): void {
    const press = this.press;
    if (press === undefined) {
      this.hover(input);
      return;
    }
    const moved = Math.hypot(input.screen.x - press.screen.x, input.screen.y - press.screen.y);
    if (!press.isDragging && moved < PEN_DRAG_DEAD_ZONE_PX) return;
    press.isDragging = true;
    const point = this.session.toLocal(input.world);
    const { base, target } = press;
    if (target.kind === 'vertices') {
      const [dx, dy] = [point.x - press.start.x, point.y - press.start.y];
      press.network = moveVertices(base, this.selected, dx, dy);
    } else {
      const offset = { x: point.x - target.origin.x, y: point.y - target.origin.y };
      const isBreaking = isAltHeld(input);
      press.network = setHandle(base, target.segmentId, target.end, offset, isBreaking);
    }
    this.session.preview(press.network);
    this.context.onChange();
  }

  /**
   * The pointer with no button down (`VectorEditView.hover`): a change is signalled only when
   * the hovered segment or the cursor changed.
   *
   * @param input - The pointer.
   */
  private hover(input: SelectPointer): void {
    const path = this.session.path();
    if (path === undefined) return;
    const point = this.session.toLocal(input.world);
    if (this.view.hover(path, this.selected, point)) this.context.onChange();
  }

  /** A release: a drag is written in one command; a click writes nothing. */
  private onRelease(): void {
    const press = this.press;
    if (press === undefined) return;
    this.press = undefined;
    if (press.isDragging) this.write(press.base, press.network);
    else this.session.endPreview();
    this.context.onChange();
  }

  /** Drops a drag without writing (a second finger, the pointer lost). */
  private cancelPress(): void {
    if (this.press === undefined) return;
    this.press = undefined;
    this.session.endPreview();
    this.context.onChange();
  }

  /**
   * Delete (Shift: delete and heal) of the selected vertices; a path left with no segment is
   * deleted and editing ends.
   *
   * @param isHealing - Whether to join the neighbours of deleted vertices.
   */
  private deleteSelected(isHealing: boolean): void {
    this.cancelPress();
    const path = this.session.path();
    if (path === undefined || this.selected.size === 0) return;
    const newId = () => this.context.environment.createId();
    const network = isHealing
      ? deleteAndHeal(path, this.selected, newId)
      : deleteVertices(path, this.selected);
    this.selected = new Set();
    if (network.segments.length === 0) {
      this.session.delete();
      this.context.requestExit();
      return;
    }
    this.write(path, network);
    this.context.onChange();
  }

  /**
   * Writes a gesture; editing ends when the path was locked meanwhile (the person is told).
   *
   * @param base - The network before.
   * @param network - The network after.
   */
  private write(base: PathNetwork, network: PathNetwork): void {
    if (this.session.write(base, network) === 'locked') this.context.requestExit();
  }
}
