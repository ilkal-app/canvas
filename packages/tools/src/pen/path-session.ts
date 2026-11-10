import {
  createObjectCommand,
  deleteObjectsCommand,
  editNetworkCommand,
  runCommand,
  type CommandError,
} from '@canvas/document';
import { worldTransformOf, type PathNetwork, type WorldTransform } from '@canvas/engine';
import type { BoardObjectOf, ObjectId, Point, StrokeStyle } from '@canvas/schema';

import { withCreationParent } from '../frame/creation-parent.js';
import { creationColor } from '../ink/creation-ink.js';
import { strokeStyleOf } from '../stroke-style-of.js';
import { DRAFT_PREVIEW_Z } from '../text/text-session-object.js';

import { isEmptyNetworkEdit, networkEditOf } from './network-edit.js';
import type { PenModeContext } from './pen-context.js';

/** What the person is told when the path they edit was locked meanwhile. */
export const PATH_LOCKED_NOTICE = 'The path is locked: unlock it to edit its points.';

/** A path object. */
export type PathObject = BoardObjectOf<'path'>;

/** A network with nothing in it. */
const EMPTY_NETWORK: PathNetwork = Object.freeze({
  vertices: Object.freeze([]),
  segments: Object.freeze([]),
});

/** How a write ended. */
export type PathWrite = 'written' | 'unchanged' | 'refused' | 'locked';

/**
 * The one path a pen or vector-edit session works on: the path the
 * document holds, or a draft the pen's first press made, which the document gets with the first
 * release that leaves it a segment (`createObject`): a path is never written without one. It converts between the world and the path's own frame,
 * previews a gesture's network without writing it, and writes each gesture as one command: the
 * `editNetwork` of the members the gesture changed (`networkEditOf`), so a collaborator's edits
 * of other members merge. Main thread; no DOM.
 */
export class PathSession {
  private readonly context: PenModeContext;
  private pathId: ObjectId | undefined;
  /** The draft, until its first write creates it. */
  private draft: PathObject | undefined;
  private isPreviewing = false;

  /**
   * Follows a path, or none yet.
   *
   * @param context - The mode's context.
   * @param id - The path the document holds, if any.
   */
  constructor(context: PenModeContext, id?: ObjectId) {
    this.context = context;
    this.pathId = id;
  }

  /**
   * The path's id, the draft's included.
   *
   * @returns The id, or `undefined` before the first press.
   */
  get id(): ObjectId | undefined {
    return this.pathId;
  }

  /**
   * The path as the document holds it, or the draft.
   *
   * @returns The path, or `undefined` when there is none (never made, deleted, undone).
   */
  path(): PathObject | undefined {
    if (this.draft !== undefined) return this.draft;
    if (this.pathId === undefined) return undefined;
    const object = this.context.store.get(this.pathId);
    return object?.type === 'path' ? object : undefined;
  }

  /**
   * The path's network.
   *
   * @returns The network; empty when there is no path.
   */
  network(): PathNetwork {
    return this.path() ?? EMPTY_NETWORK;
  }

  /**
   * The path's own frame in the world (its placement composed with its ancestors').
   *
   * @returns The transform; the identity when there is no path.
   */
  frame(): WorldTransform {
    const path = this.path();
    if (path === undefined) return { cos: 1, sin: 0, x: 0, y: 0 };
    // A draft is not in the document, but its parent chain is.
    return worldTransformOf(path, this.context.store);
  }

  /**
   * A world point in the path's frame.
   *
   * @param world - The point, world units.
   * @returns The point, local units.
   */
  toLocal(world: Point): Point {
    const { cos, sin, x, y } = this.frame();
    const [dx, dy] = [world.x - x, world.y - y];
    return { x: cos * dx + sin * dy, y: -sin * dx + cos * dy };
  }

  /**
   * Starts a new path at a point, as a draft the next write creates.
   *
   * @param world - Its origin, the first vertex's place, world units.
   */
  startDraft(world: Point): void {
    const style = this.context.newPathStyle();
    const { stroke, fill } = style;
    const { store, creationInk } = this.context;
    // The outline's `ink` is resolved where the path starts.
    const color = stroke && creationColor(store, world, stroke.color, creationInk, 'pen');
    this.makeDraft({
      parentId: null,
      x: world.x,
      y: world.y,
      rotation: 0,
      stroke: stroke === null || color === null ? null : { ...stroke, color },
      fill,
      ...strokeStyleOf(style),
    });
  }

  /**
   * Deletes the document's path (one command) and goes on with an empty draft in the same frame
   * and style, so the vertex the pen holds (the last one Backspace left) keeps its place and the
   * next segment creates the path again. Nothing happens for a draft or when there is no path.
   *
   * @returns `locked` when the path was locked meanwhile (the person is told; nothing changes),
   *   else `written`.
   */
  redraft(): PathWrite {
    const path = this.path();
    if (path === undefined || this.draft !== undefined) return 'unchanged';
    if (path.locked) {
      this.context.onNotice?.(PATH_LOCKED_NOTICE);
      return 'locked';
    }
    const { parentId, x, y, rotation, stroke, fill } = path;
    this.delete();
    this.makeDraft({ parentId, x, y, rotation, stroke, fill, ...strokeStyleOf(path) });
    return 'written';
  }

  /**
   * Makes the draft: a path with no network yet, under a new id.
   *
   * @param fields - Its placement and paint.
   */
  private makeDraft(
    fields: Pick<PathObject, 'parentId' | 'x' | 'y' | 'rotation' | 'stroke' | 'fill'> & StrokeStyle,
  ): void {
    const { environment, origin } = this.context;
    const now = environment.clock();
    this.draft = {
      ...fields,
      id: environment.createId(),
      type: 'path',
      z: DRAFT_PREVIEW_Z,
      locked: false,
      createdBy: origin.principalId,
      createdAt: now,
      updatedAt: now,
      vertices: [],
      segments: [],
    };
    this.pathId = this.draft.id;
  }

  /**
   * Shows the path with another network, without writing it.
   *
   * @param network - The network to show.
   */
  preview(network: PathNetwork): void {
    const path = this.path();
    if (path === undefined) return;
    this.isPreviewing = true;
    this.context.setPreview(path.id, {
      ...path,
      vertices: [...network.vertices],
      segments: [...network.segments],
    });
  }

  /** Drops the preview, so the document's path shows again. */
  endPreview(): void {
    if (!this.isPreviewing || this.pathId === undefined) return;
    this.isPreviewing = false;
    this.context.setPreview(this.pathId, undefined);
  }

  /**
   * Writes a gesture: creates the draft with the network once it has a segment, or edits the
   * path's network from `base` to `network` in one `editNetwork`. The preview is dropped either
   * way.
   *
   * @param base - The network the gesture started from.
   * @param network - The network it ends with.
   * @returns How the write ended; `unchanged` for a draft with no segment yet; `locked` when
   *   the path was locked meanwhile (the person is told), `refused` for another refusal
   *   (reported).
   */
  write(base: PathNetwork, network: PathNetwork): PathWrite {
    this.endPreview();
    const { store, origin, environment } = this.context;
    const draft = this.draft;
    if (draft !== undefined) {
      if (network.segments.length === 0) return 'unchanged';
      const object = {
        ...draft,
        vertices: [...network.vertices],
        segments: [...network.segments],
        z: undefined,
        createdBy: undefined,
        createdAt: undefined,
        updatedAt: undefined,
      };
      // Drawn in a section, it joins it (item 9).
      const placed = withCreationParent(store, object);
      const created = runCommand(
        store,
        origin,
        createObjectCommand,
        { object: placed },
        environment,
      );
      if (created.status !== 'applied') return this.refused(created.errors);
      this.draft = undefined;
      this.context.selectObjects([draft.id]);
      return 'written';
    }
    const id = this.pathId;
    const edit = networkEditOf(base, network);
    if (id === undefined || isEmptyNetworkEdit(edit)) return 'unchanged';
    const input = {
      id,
      setVertices: [...edit.setVertices],
      deleteVertexIds: [...edit.deleteVertexIds],
      setSegments: [...edit.setSegments],
      deleteSegmentIds: [...edit.deleteSegmentIds],
    };
    const outcome = runCommand(store, origin, editNetworkCommand, input, environment);
    return outcome.status === 'applied' ? 'written' : this.refused(outcome.errors);
  }

  /**
   * Deletes the path (the last vertex backspaced away, or nothing left to draw); a draft is
   * dropped without a write.
   */
  delete(): void {
    this.endPreview();
    const id = this.pathId;
    this.pathId = undefined;
    if (this.draft !== undefined) {
      this.draft = undefined;
      return;
    }
    if (id === undefined || this.context.store.get(id) === undefined) return;
    const { store, origin, environment } = this.context;
    runCommand(store, origin, deleteObjectsCommand, { ids: [id] }, environment);
  }

  /**
   * Leaves the path (the prototype's `finishObject`): a path left with no segment is deleted (a
   * read already leaves out the vertices no segment touches once it has one); a draft is
   * dropped. Whether the path has a segment is read from the document right before the delete,
   * so a segment a collaborator added while it was edited keeps it. The session then follows no
   * path.
   *
   * @returns The id of the path that stays, or `undefined` when none does.
   */
  finish(): ObjectId | undefined {
    this.endPreview();
    if (this.draft !== undefined) {
      this.delete();
      return undefined;
    }
    const id = this.pathId;
    this.pathId = undefined;
    if (id === undefined) return undefined;
    // Re-read at the commit: never a network read earlier in the gesture or the mode.
    const object = this.context.store.get(id);
    if (object?.type !== 'path') return undefined;
    if (object.locked || object.segments.length > 0) return id;
    const { store, origin, environment } = this.context;
    runCommand(store, origin, deleteObjectsCommand, { ids: [id] }, environment);
    return undefined;
  }

  /**
   * Leaves the path writing nothing (a person who can no longer edit): a draft is
   * dropped and a path left with no segment stays as it was written. The session then follows
   * no path.
   */
  abandon(): void {
    this.endPreview();
    this.draft = undefined;
    this.pathId = undefined;
  }

  /**
   * Reports a refused write.
   *
   * @param errors - The command's errors.
   * @returns `locked` when the path was locked, else `refused`.
   */
  private refused(errors: readonly CommandError[]): PathWrite {
    if (errors.some(({ code }) => code === 'locked')) {
      this.context.onNotice?.(PATH_LOCKED_NOTICE);
      return 'locked';
    }
    this.context.onCommandRefused?.(errors);
    return 'refused';
  }
}
