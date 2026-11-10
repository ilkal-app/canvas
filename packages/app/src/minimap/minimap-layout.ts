import { colorForPrincipal, type PresenceSnapshot } from '@canvas/collab';
import type { Camera, WorldBounds } from '@canvas/engine';
import type { BoardObject, Rgba, StickyObject } from '@canvas/schema';

// The minimap's geometry (the design board's Whiteboard page, frame B): the board's
// top-level objects of the page shown and the view, drawn small in a 216 × 120 map. The map
// shows the box around both, with a margin, scaled to fit and centred. Pure.

/** A rectangle in world units. */
export interface WorldRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What one object draws as in the map. */
export interface MinimapItem extends WorldRect {
  /** A section (frame) draws as its outline, a sticky in its colour, anything else as a block. */
  readonly kind: 'frame' | 'sticky' | 'other';
  /** A sticky's colour, when it is one (a token colour draws as any other object). */
  readonly color?: Rgba;
}

/** How the map shows the board: its world box and how many map px a world unit is. */
export interface MinimapFrame {
  /** The world box the map shows, centred in the map. */
  readonly world: WorldRect;
  /** Map px per world unit. */
  readonly scale: number;
  /** Where the world box's top-left sits in the map, px. */
  readonly offsetX: number;
  readonly offsetY: number;
}

/** The share of the shown box added on each side, so nothing touches the map's edge. */
const MARGIN = 0.05;

/**
 * The world rectangle a camera shows.
 *
 * @param camera - The camera.
 * @returns Its view, in world units.
 */
export function viewOf(camera: Camera): WorldRect {
  return {
    x: camera.x,
    y: camera.y,
    width: camera.viewportWidthPx / camera.zoom,
    height: camera.viewportHeightPx / camera.zoom,
  };
}

/**
 * A sticky's stored colour when it is a tuple, none for a token reference.
 *
 * @param sticky - The sticky.
 * @returns The tuple, or undefined.
 */
function storedTupleOf(sticky: StickyObject): Rgba | undefined {
  return Array.isArray(sticky.color) ? sticky.color : undefined;
}

/**
 * The map items of a page's top-level objects: their world boxes (rotated objects by their
 * rotated box), a section as an outline and a sticky in its colour; an object with no box (a
 * group, a comment, an empty path) is left out.
 *
 * @param objects - The page's top-level objects.
 * @param boundsOf - An object's world box (`worldBoundsOf` with its world transform).
 * @param stickyColorOf - A sticky's colour to draw, resolved (a token reference in the board's
 *   token table and the sticky's colour mode); its stored tuple, or none for a token, if absent.
 * @returns The items, in the order given.
 */
export function minimapItems(
  objects: readonly BoardObject[],
  boundsOf: (object: BoardObject) => WorldBounds | undefined,
  stickyColorOf: (sticky: StickyObject) => Rgba | undefined = storedTupleOf,
): MinimapItem[] {
  return objects.flatMap((object): MinimapItem[] => {
    const bounds = boundsOf(object);
    if (bounds === undefined) return [];
    const box = {
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
    };
    if (object.type === 'frame') return [{ ...box, kind: 'frame' }];
    if (object.type === 'sticky') {
      const color = stickyColorOf(object);
      return [color === undefined ? { ...box, kind: 'sticky' } : { ...box, kind: 'sticky', color }];
    }
    return [{ ...box, kind: 'other' }];
  });
}

/**
 * How a map of the given size shows the items and the view: the box around them all with a 5%
 * margin each side, scaled to fit the map and centred in it.
 *
 * @param items - The map's items.
 * @param view - The view.
 * @param mapWidth - The map's width, px.
 * @param mapHeight - The map's height, px.
 * @returns The frame.
 */
export function minimapFrame(
  items: readonly WorldRect[],
  view: WorldRect,
  mapWidth: number,
  mapHeight: number,
): MinimapFrame {
  let minX = view.x;
  let minY = view.y;
  let maxX = view.x + view.width;
  let maxY = view.y + view.height;
  for (const item of items) {
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.width);
    maxY = Math.max(maxY, item.y + item.height);
  }
  const marginX = (maxX - minX) * MARGIN;
  const marginY = (maxY - minY) * MARGIN;
  const world = {
    x: minX - marginX,
    y: minY - marginY,
    width: Math.max(maxX - minX + 2 * marginX, Number.EPSILON),
    height: Math.max(maxY - minY + 2 * marginY, Number.EPSILON),
  };
  const scale = Math.min(mapWidth / world.width, mapHeight / world.height);
  return {
    world,
    scale,
    offsetX: (mapWidth - world.width * scale) / 2,
    offsetY: (mapHeight - world.height * scale) / 2,
  };
}

/**
 * Where a world rectangle sits in the map.
 *
 * @param frame - The map's frame.
 * @param rect - The rectangle, world units.
 * @returns It in map px.
 */
export function toMap(frame: MinimapFrame, rect: WorldRect): WorldRect {
  return {
    x: frame.offsetX + (rect.x - frame.world.x) * frame.scale,
    y: frame.offsetY + (rect.y - frame.world.y) * frame.scale,
    width: rect.width * frame.scale,
    height: rect.height * frame.scale,
  };
}

/**
 * The world point under a map point.
 *
 * @param frame - The map's frame.
 * @param mapX - The point's x in the map, px.
 * @param mapY - The point's y in the map, px.
 * @returns The world point.
 */
export function toWorld(
  frame: MinimapFrame,
  mapX: number,
  mapY: number,
): { readonly x: number; readonly y: number } {
  return {
    x: frame.world.x + (mapX - frame.offsetX) / frame.scale,
    y: frame.world.y + (mapY - frame.offsetY) / frame.scale,
  };
}

/**
 * The screen offset that centres the view on a world point at the same zoom: what the board
 * moves by, as under a drag.
 *
 * @param camera - The camera now.
 * @param target - The world point to centre on.
 * @param target.x - Its x, world units.
 * @param target.y - Its y, world units.
 * @returns The offset, CSS px.
 */
export function panToCentre(
  camera: Camera,
  target: { readonly x: number; readonly y: number },
): { readonly deltaXPx: number; readonly deltaYPx: number } {
  const view = viewOf(camera);
  return {
    deltaXPx: (view.x + view.width / 2 - target.x) * camera.zoom,
    deltaYPx: (view.y + view.height / 2 - target.y) * camera.zoom,
  };
}

/** How far a wheel turns the zoom: e to the power of the wheel's lines over this (the canvas's). */
export const MAP_WHEEL_DELTA_PER_LOG_ZOOM = 100;

/**
 * The zoom a wheel on the map asks for: about the board point under the pointer, as the canvas's
 * own wheel zoom with the zoom modifier, so that point stays where it is on the canvas. Pure.
 *
 * @param camera - The camera.
 * @param target - The board point under the pointer.
 * @param target.x - Across, board units.
 * @param target.y - Down, board units.
 * @param deltaYPx - The wheel's vertical delta, CSS px: down zooms out.
 * @returns The canvas point kept still, CSS px, and the zoom factor.
 */
export function wheelZoomAt(
  camera: Camera,
  target: { readonly x: number; readonly y: number },
  deltaYPx: number,
): { readonly centerXPx: number; readonly centerYPx: number; readonly scale: number } {
  return {
    centerXPx: (target.x - camera.x) * camera.zoom,
    centerYPx: (target.y - camera.y) * camera.zoom,
    scale: Math.exp(-deltaYPx / MAP_WHEEL_DELTA_PER_LOG_ZOOM),
  };
}

/** A collaborator's view on the map: its region and their colour. */
export interface PeerView extends WorldRect {
  /** Their colour, `#rrggbb`. */
  readonly color: string;
}

/**
 * The views of the collaborators on a page: each client's presence viewport, where it
 * shares one, on that page (a client of a build without pages is on the first page). Pure.
 *
 * @param snapshot - Every other client's presence.
 * @param page - The page shown.
 * @param firstPage - The page a client without one is on.
 * @returns Their views.
 */
export function peerViewsOf(
  snapshot: PresenceSnapshot,
  page: string,
  firstPage: string,
): PeerView[] {
  const views: PeerView[] = [];
  for (const state of snapshot.values()) {
    const { viewport } = state;
    if (viewport === undefined || (state.page ?? firstPage) !== page) continue;
    views.push({
      x: viewport.x,
      y: viewport.y,
      width: viewport.w,
      height: viewport.h,
      // Their colourway's dark, derived from their id as every view does.
      color: colorForPrincipal(state.principal.id),
    });
  }
  return views;
}
