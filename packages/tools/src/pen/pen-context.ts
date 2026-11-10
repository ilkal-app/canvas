import type {
  CommandEnvironment,
  CommandError,
  DocumentStore,
  TransactionOrigin,
} from '@canvas/document';
import type { WorldBounds } from '@canvas/engine';
import type { BoardObject, ObjectId, Paint, Point, Stroke, StrokeStyle } from '@canvas/schema';

import type { CreationInkSource } from '../ink/creation-ink.js';
import type { SnapSettings } from '../select/drag-snap.js';
import type { SnappedPoint } from '../snap/snap-point.js';

/** The paint a new path starts with: the pen tool's style. */
export interface PenStyle extends StrokeStyle {
  /** The outline, or null for none. */
  readonly stroke: Stroke | null;
  /** The fill of closed loops, a colour or a gradient, or null for none. */
  readonly fill: Paint | null;
}

/** What a pen point snaps with at one press. */
export interface PenSnapRequest {
  /** The camera zoom, CSS px per world unit: the threshold and the grid follow it. */
  readonly zoom: number;
  /** Whether snapping is on and whether the grid shows. */
  readonly settings: SnapSettings;
  /** Objects not to snap to: the path being drawn. */
  readonly excludedIds: ReadonlySet<ObjectId>;
  /** What is on screen, world units: points snap only to objects in it; everywhere if absent. */
  readonly viewport?: WorldBounds | undefined;
}

/**
 * What the pen tool and vector edit work on and report to.
 * The app's tool-mode services give it. Main thread.
 */
export interface PenModeContext {
  /** The document; the modes write to it only through commands. */
  readonly store: DocumentStore;
  /** Who the modes' commands are attributed to. */
  readonly origin: TransactionOrigin;
  /** The command clock and id generator; vertex and segment ids come from `createId` too. */
  readonly environment: CommandEnvironment;
  /** The paint a new path starts with: the pen tool's style. */
  readonly newPathStyle: () => PenStyle;
  /**
   * The creator's theme and image colours, for a new path's default outline colour; the light
   * theme when absent.
   */
  readonly creationInk?: CreationInkSource;
  /**
   * Shows a path as a gesture shapes it, without writing it (a drag previews locally and writes
   * once on release); `undefined` drops the preview.
   */
  readonly setPreview: (id: ObjectId, object: BoardObject | undefined) => void;
  /** Selects objects with the select tool: the path being drawn or edited. */
  readonly selectObjects: (ids: readonly ObjectId[]) => void;
  /** Ends the mode from outside an input (Escape with nothing left to end). */
  readonly requestExit: () => void;
  /** Called whenever what the mode shows changed. */
  readonly onChange: () => void;
  /** Receives a sentence for the person: the path was locked meanwhile. */
  readonly onNotice?: (message: string) => void;
  /** Receives the errors of an edit the document refused for another reason. */
  readonly onCommandRefused?: (errors: readonly CommandError[]) => void;
  /**
   * Snaps a new point to nearby objects' edges and centres and the grid,
   * as the select tool snaps its drags; no snapping when absent.
   *
   * @param world - The point, world units.
   * @param request - The zoom, the settings and the objects to leave out.
   * @returns The snapped point and its guides.
   */
  readonly snapPoint?: (world: Point, request: PenSnapRequest) => SnappedPoint;
}

/**
 * Whether Alt is held. The shared pointer input carries Alt as `isSnapSuspended`, the select
 * tool's snap modifier; the pen and vector editing read it as Alt (break the mirror, toggle
 * corner and smooth) and never suspend snapping with it.
 *
 * @param input - A pointer input.
 * @param input.isSnapSuspended - Alt, as the shared input names it; absent is not held.
 * @returns `true` while Alt is held.
 */
export function isAltHeld(input: { readonly isSnapSuspended?: boolean | undefined }): boolean {
  return input.isSnapSuspended ?? false;
}
