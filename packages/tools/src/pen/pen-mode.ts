import { visibleWorldBounds, type PathNetwork } from '@canvas/engine';
import type { ObjectId, Point, Vertex } from '@canvas/schema';

import type { ScreenPoint } from '../camera/camera-moves.js';
import type { ToolId } from '../modes/tool-ids.js';
import {
  TOOL_STEP_CONTINUE,
  type ToolCursor,
  type ToolKeyInput,
  type ToolMode,
  type ToolPointerInput,
  type ToolStep,
} from '../modes/tool-mode.js';
import type { SelectionOverlayModel } from '../select/overlay-rects.js';
import type { SelectPointer } from '../select/select-input.js';
import type { SnapGuide } from '../snap/snap-guide.js';

import { constrain45 } from './constrain-45.js';
import { SEGMENT_HIT_TOLERANCE_PX, VERTEX_HIT_TOLERANCE_PX } from './network-hit.js';
import { vertexOf } from './network.js';
import { PathSession } from './path-session.js';
import { isAltHeld, type PenModeContext } from './pen-context.js';
import {
  NO_CHAIN,
  penBackspace,
  penDrag,
  penPress,
  type PenChain,
  type PenDrag,
} from './pen-gesture.js';
import { splitHeld, withHeld } from './pen-held-vertex.js';
import { penOverlay } from './pen-overlay.js';
import { penPressPoint, snapPenWorld } from './pen-press-point.js';

/**
 * How far a press must move, CSS px from where it landed, before it drags a handle (the
 * prototype's press-relative dead zone): a press a few px off a vertex with a pixel of jitter
 * still reads as a click.
 */
export const PEN_DRAG_DEAD_ZONE_PX = 3;

/** How a pen mode starts. */
export type PenModeStart =
  | {
      /** The pen tool: the first press starts a new path. */
      readonly kind: 'create';
    }
  | {
      /** The pen sub-tool of vector editing: presses act on this path. */
      readonly kind: 'edit';
      /** The path. */
      readonly id: ObjectId;
    };

/** A pointer input that carries a point: a press, a move or a release. */
type PointerStep = Exclude<ToolPointerInput, { readonly kind: 'hold' | 'pointerCancel' }>;

/** Builds the move sub-tool of vector editing on a path (`createVectorEditMode`). */
export type VectorEditFactory = (id: ObjectId) => ToolMode;

/** A press under way. */
interface PenPressState {
  /** The network before the press, the held vertex included. */
  readonly base: PathNetwork;
  /** The path's own network before the press: what the write is a change of. */
  readonly written: PathNetwork;
  /** The network as the press (and its drag) leaves it now. */
  network: PathNetwork;
  /** The chain before the press, restored when the press is cancelled. */
  readonly chainBefore: PenChain;
  /** The drag the press may become. */
  readonly drag: PenDrag | undefined;
  /** Where the press landed, CSS px: the dead zone is measured from here. */
  readonly screen: ScreenPoint;
  /** Whether the press has left the dead zone. */
  isDragging: boolean;
}

/**
 * The pen tool (the prototype's `PenMode`, webgl-whiteboard `src/app/modes/penMode.ts`): the first
 * press starts a path at one vertex, and each press after it places a corner (a click) or a smooth
 * point (a click-drag, the incoming handle mirrored; Alt breaks the mirror, Shift keeps points and
 * handles on 45° steps) joined to the chain; a press on a vertex connects to it and ends the chain,
 * closing a loop at its start, or starts a chain from it; a press on a segment inserts a vertex
 * without moving the curve. Backspace removes the chain's last vertex (the path itself once nothing
 * is left); Enter or Escape ends the chain, then leaves the path (dropping stray vertices, or the
 * path when it has no segment), then the tool. A chain's vertex that no segment joins yet (the
 * first click) is held in the mode and previewed, never written (`pen-held-vertex.ts`): the path is
 * created with its first segment, so Escape after one click writes nothing. Each other press is one
 * command, written on release (the path's `createObject`, then one `editNetwork` each), and a drag
 * previews without writing. V switches to vector editing's move sub-tool once the path has a
 * segment. Main thread; no DOM.
 */
export class PenMode implements ToolMode {
  readonly id = 'pen' as const;
  /** The crosshair, everywhere. */
  readonly cursor: ToolCursor = 'crosshair';
  private readonly context: PenModeContext;
  private readonly makeEdit: VectorEditFactory | undefined;
  private session: PathSession;
  private chain: PenChain = NO_CHAIN;
  /** The chain's vertex while no segment joins it: shown, not written. */
  private held: Vertex | undefined;
  private press: PenPressState | undefined;
  /** The pointer while no button is down, local units: the next segment's preview end. */
  private hover: Point | undefined;
  private guides: readonly SnapGuide[] = [];
  private zoom = 1;
  private isExited = false;

  /**
   * Starts the mode.
   *
   * @param context - The document, the pen style and the callbacks.
   * @param start - Whether to start a new path or act on one.
   * @param makeEdit - Builds the move sub-tool V switches to; V ends the pen when absent.
   */
  constructor(context: PenModeContext, start: PenModeStart, makeEdit?: VectorEditFactory) {
    this.context = context;
    this.makeEdit = makeEdit;
    this.session = new PathSession(context, start.kind === 'edit' ? start.id : undefined);
  }

  /**
   * The path the pen draws on, if any.
   *
   * @returns Its id, the draft's included.
   */
  get pathId(): ObjectId | undefined {
    return this.session.id;
  }

  /**
   * The chain being drawn.
   *
   * @returns The vertex the next segment starts from and its handle.
   */
  get currentChain(): PenChain {
    return this.chain;
  }

  onPointer(input: ToolPointerInput): ToolStep {
    // The pen never finishes on a pointer; a context press or a hold does nothing.
    if (input.kind === 'pointerCancel') this.cancelPress();
    if (input.kind === 'pointerDown' || input.kind === 'pointerMove') this.zoom = input.zoom;
    if (input.kind === 'pointerDown') this.onPress(input);
    else if (input.kind === 'pointerMove') this.onMove(input);
    else if (input.kind === 'pointerUp') this.onRelease();
    return TOOL_STEP_CONTINUE;
  }

  onKey(input: ToolKeyInput): boolean {
    switch (input.kind) {
      case 'escape':
      case 'enter':
        this.endChainOrPath();
        return true;
      case 'delete':
        this.backspace();
        return true;
      case 'selectAll':
      case 'nudge':
        return false;
    }
  }

  overlay(): Partial<SelectionOverlayModel> {
    return penOverlay({
      network: this.press?.network ?? this.network(),
      frame: this.session.frame(),
      zoom: this.zoom,
      chain: this.chain,
      dragVertexId: this.press?.drag?.vertexId,
      hover: this.press === undefined ? this.hover : undefined,
      guides: this.guides,
    });
  }

  onZoom(zoom: number): void {
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    this.context.onChange();
  }

  onToolSwitch(tool: ToolId): ToolMode | undefined {
    const id = this.session.id;
    const { makeEdit } = this;
    if (tool !== 'select' || !makeEdit || id === undefined || !this.session.path())
      return undefined;
    // A lone first point has nothing to edit yet: the pen stays.
    if (this.session.network().segments.length === 0) return this;
    this.cancelPress();
    return makeEdit(id);
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
   * A press: on a path that is gone (deleted, undone) or never made, a new draft starts at the
   * press; then the press step is previewed.
   *
   * @param input - The press.
   */
  private onPress(input: PointerStep): void {
    this.cancelPress();
    if (this.session.path() === undefined) {
      this.session = new PathSession(this.context);
      this.chain = NO_CHAIN;
      this.held = undefined;
    }
    let point = { x: 0, y: 0 };
    const isStarting = this.session.id === undefined;
    const snapping = {
      snap: this.context.snapPoint,
      settings: input.snapping,
      zoom: this.zoom,
      excludedIds: new Set(this.session.id === undefined ? [] : [this.session.id]),
      viewport: input.camera && visibleWorldBounds(input.camera),
    };
    if (isStarting) {
      const start = snapPenWorld(input.world, snapping);
      this.session.startDraft(start.point);
      this.guides = start.guides;
    }
    const written = this.session.network();
    const base = withHeld(written, this.held);
    const from =
      this.chain.vertexId === undefined ? undefined : vertexOf(base, this.chain.vertexId);
    if (from === undefined) this.chain = NO_CHAIN;
    if (!isStarting) {
      const toLocal = (world: Point) => this.session.toLocal(world);
      const landed = penPressPoint(
        base,
        input.world,
        toLocal,
        from,
        input.isShiftPressed,
        snapping,
      );
      this.guides = landed.guides;
      point = landed.point;
    }
    const tolerances = {
      vertex: VERTEX_HIT_TOLERANCE_PX / this.zoom,
      segment: SEGMENT_HIT_TOLERANCE_PX / this.zoom,
    };
    const newId = () => this.context.environment.createId();
    const step = penPress(base, this.chain, point, tolerances, newId);
    this.press = {
      base,
      written,
      network: step.network,
      chainBefore: this.chain,
      drag: step.drag,
      screen: input.screen,
      isDragging: false,
    };
    this.chain = step.chain;
    this.hover = undefined;
    if (step.network !== base) this.session.preview(step.network);
    this.context.onChange();
  }

  /**
   * A move: a drag past the dead zone shapes the press's handles; with no button down, the next
   * segment's preview follows the pointer.
   *
   * @param input - The pointer.
   */
  private onMove(input: SelectPointer): void {
    const press = this.press;
    const local = this.session.toLocal(input.world);
    if (press === undefined) {
      const network = this.network();
      const from =
        this.chain.vertexId === undefined ? undefined : vertexOf(network, this.chain.vertexId);
      this.hover = input.isShiftPressed && from ? constrain45(from, local) : local;
      if (from) this.context.onChange();
      return;
    }
    const moved = Math.hypot(input.screen.x - press.screen.x, input.screen.y - press.screen.y);
    if (!press.isDragging && moved < PEN_DRAG_DEAD_ZONE_PX) return;
    if (!press.drag) return;
    press.isDragging = true;
    // Alt, the snap modifier, breaks the mirror while the pen shapes a handle.
    const isAltPressed = isAltHeld(input);
    const shaped = penDrag(press.drag, this.chain, local, input.isShiftPressed, isAltPressed);
    press.network = shaped.network;
    this.chain = shaped.chain;
    this.session.preview(shaped.network);
    this.context.onChange();
  }

  /**
   * A release: the press's network is written in one command, less a chain vertex no segment
   * joins yet, which is held; a join ends the chain.
   */
  private onRelease(): void {
    const press = this.press;
    if (press === undefined) return;
    this.press = undefined;
    this.guides = [];
    if (press.drag?.kind === 'join') this.chain = NO_CHAIN;
    const { written, held } = splitHeld(press.network, this.chain.vertexId);
    this.held = held;
    const result = this.session.write(press.written, written);
    if (result === 'refused') this.endChain();
    this.context.onChange();
    if (result === 'locked') this.context.requestExit();
  }

  /**
   * The network the pen works on: the path's, with the held vertex.
   *
   * @returns The network.
   */
  private network(): PathNetwork {
    return withHeld(this.session.network(), this.held);
  }

  /** Ends the chain, dropping a held vertex. */
  private endChain(): void {
    this.chain = NO_CHAIN;
    this.held = undefined;
  }

  /** Drops a press without writing (a second finger, the pointer lost): nothing changes. */
  private cancelPress(): void {
    const press = this.press;
    if (press === undefined) return;
    this.press = undefined;
    this.guides = [];
    this.chain = press.chainBefore;
    this.session.endPreview();
    this.context.onChange();
  }

  /** Enter or Escape: ends the chain; with none, leaves the path; with no path, the tool. */
  private endChainOrPath(): void {
    this.cancelPress();
    if (this.chain.vertexId !== undefined) {
      this.endChain();
      this.hover = undefined;
      this.context.onChange();
      return;
    }
    if (this.session.id === undefined) {
      this.context.requestExit();
      return;
    }
    const kept = this.session.finish();
    this.session = new PathSession(this.context);
    if (kept !== undefined) this.context.selectObjects([kept]);
  }

  /**
   * Backspace (or Delete) while drawing: see `penBackspace`. A vertex it steps back to that no
   * segment joins any more is held; when that was the path's last segment, the path is deleted
   * and the pen goes on with a draft holding the vertex; the last vertex takes the path.
   */
  private backspace(): void {
    this.cancelPress();
    if (this.chain.vertexId === undefined || this.session.path() === undefined) return;
    const written = this.session.network();
    const step = penBackspace(this.network(), this.chain);
    this.chain = step.chain;
    const split = splitHeld(step.network, step.chain.vertexId);
    this.held = split.held;
    this.context.onChange();
    if (split.written.vertices.length > 0) {
      if (this.session.write(written, split.written) === 'locked') this.context.requestExit();
    } else if (split.held === undefined) {
      this.session.delete();
      this.session = new PathSession(this.context);
      this.endChain();
    } else if (this.session.redraft() === 'locked') {
      this.context.requestExit();
    }
  }
}
