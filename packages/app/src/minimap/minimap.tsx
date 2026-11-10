import { useEffect, useRef, type PointerEvent, type ReactElement, type RefObject } from 'react';

import type { PresenceSnapshot } from '@canvas/collab';
import { worldBoundsOf, worldTransformOf, type Camera } from '@canvas/engine';
import {
  DEFAULT_PAGE_ID,
  effectiveColorMode,
  resolveColor,
  type BoardObject,
  type ObjectId,
  type StickyObject,
} from '@canvas/schema';
import { wheelDeltaPx } from '@canvas/tools';

import type { CameraSource } from '../editing/camera-source.js';
import type { BoardView } from '../engine/board-view.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ThemeName } from '../theme/theme-tokens.js';

import {
  minimapFrame,
  minimapItems,
  panToCentre,
  peerViewsOf,
  toMap,
  wheelZoomAt,
  toWorld,
  viewOf,
  type MinimapFrame,
  type MinimapItem,
  type WorldRect,
} from './minimap-layout.js';
import styles from './minimap.module.css';

/** The map's width, CSS px (the design's 216 × 120). */
export const MINIMAP_WIDTH = 216;

/** The map's height, CSS px. */
export const MINIMAP_HEIGHT = 120;

/** Props of {@link Minimap}. */
export interface MinimapProps {
  /** The board's page shown, and its changes. */
  readonly board: BoardView;
  /** The camera, and its changes. */
  readonly camera: CameraSource;
  /** Receives the pan to where the map is pressed or dragged. */
  readonly dispatch: (action: ShellAction) => void;
  /** The viewer's theme: the map's colours and its token-coloured stickies follow it. */
  readonly themeName: ThemeName;
  /** The collaborators, whose views the map draws in their colours; none if absent. */
  readonly peers?: MinimapPeers | undefined;
}

/** The collaborators a minimap draws the views of, and the page it shows. */
export interface MinimapPeers {
  /** Every other client's presence now. */
  readonly remotePresence: () => PresenceSnapshot;
  /** Calls the listener when it may have changed; returns what stops listening. */
  readonly subscribe: (listener: () => void) => () => void;
  /** The page shown. */
  readonly pageOf: () => string;
}

/** The theme colours the map draws with, read from its element's custom properties. */
interface MinimapColours {
  readonly section: string;
  readonly object: string;
  readonly view: string;
}

/**
 * What the map draws: the page's top-level objects, each section followed by its own children
 * (the stickies and notes on it), in stacking order.
 *
 * @param board - The board view.
 * @returns Them, sections before what lies on them.
 */
function pageRoots(board: BoardView): BoardObject[] {
  const reader = board.board;
  const drawn: BoardObject[] = [];
  const add = (parent: ObjectId | null): void => {
    for (const id of reader.references.childrenOf(parent)) {
      const object = reader.get(id);
      if (object === undefined) continue;
      drawn.push(object);
      if (parent === null && object.type === 'frame') add(object.id);
    }
  };
  add(null);
  return drawn;
}

/**
 * Strokes a view on the map, inside its box with 2 px corners.
 *
 * @param context - The map's 2D context.
 * @param box - The view's box on the map.
 * @param colour - The stroke's colour.
 * @param width - The stroke's width, CSS px.
 */
function strokeView(
  context: CanvasRenderingContext2D,
  box: WorldRect,
  colour: string,
  width: number,
): void {
  const inset = width / 2;
  context.strokeStyle = colour;
  context.lineWidth = width;
  context.beginPath();
  context.roundRect(box.x + inset, box.y + inset, box.width - width, box.height - width, 2);
  context.stroke();
}

/**
 * The map's items for a board: what {@link draw} needs of the objects, resolved once per
 * document, token or theme change rather than every frame, since a 50k board's world transforms
 * and boxes cost tens of ms on the page.
 */
interface MapItems {
  /** The items, in stacking order. */
  readonly items: readonly MinimapItem[];
  /** Each item's fill when it carries its own colour (a sticky), else none. */
  readonly fills: readonly (string | undefined)[];
  /** The box around them all, or none for an empty page. */
  readonly bounds: WorldRect | undefined;
}

/**
 * The map's items of the page shown, resolved.
 *
 * @param board - The board view.
 * @param theme - The viewer's theme.
 * @returns The items, their own fills and their box.
 */
function mapItemsOf(board: BoardView, theme: ThemeName): MapItems {
  const source = { get: (id: ObjectId) => board.board.get(id) };
  const modeBoard = { objects: source };
  const tokens = board.tokens?.();
  const stickyColorOf = (sticky: StickyObject) =>
    resolveColor(sticky.color, effectiveColorMode(sticky, modeBoard, theme), tokens);
  const items = minimapItems(
    pageRoots(board),
    (object) => worldBoundsOf(object, worldTransformOf(object, source)),
    stickyColorOf,
  );
  const fills = items.map(({ color }) =>
    color === undefined
      ? undefined
      : `rgba(${String(color[0] * 255)}, ${String(color[1] * 255)}, ${String(color[2] * 255)}, ${String(color[3])})`,
  );
  let bounds: WorldRect | undefined;
  for (const item of items) {
    if (bounds === undefined) {
      bounds = { x: item.x, y: item.y, width: item.width, height: item.height };
      continue;
    }
    const minX = Math.min(bounds.x, item.x);
    const minY = Math.min(bounds.y, item.y);
    const maxX = Math.max(bounds.x + bounds.width, item.x + item.width);
    const maxY = Math.max(bounds.y + bounds.height, item.y + item.height);
    bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  return { items, fills, bounds };
}

/** The board's items drawn for one frame of the map, to copy while the frame stays. */
interface BoardLayer {
  /** The canvas they are drawn on, the map's size in device px. */
  readonly canvas: HTMLCanvasElement;
  /** The frame and pixel ratio they were drawn for. */
  readonly key: string;
}

/**
 * The key of a frame at a pixel ratio: two frames with one key draw the board alike.
 *
 * @param frame - The frame.
 * @param dpr - The pixel ratio.
 * @returns The key.
 */
function layerKeyOf(frame: MinimapFrame, dpr: number): string {
  const { world, scale, offsetX, offsetY } = frame;
  return [world.x, world.y, scale, offsetX, offsetY, dpr].join(' ');
}

/**
 * Draws the board's items onto a layer the map's size: each object's box, a section in the
 * strong line colour, a sticky in its colour and anything else in the hairline colour.
 *
 * @param layer - The layer's canvas.
 * @param map - The items.
 * @param frame - How the map shows the board.
 * @param dpr - The pixel ratio.
 * @param colours - The theme colours.
 */
function drawBoardLayer(
  layer: HTMLCanvasElement,
  map: MapItems,
  frame: MinimapFrame,
  dpr: number,
  colours: MinimapColours,
): void {
  // Setting the size clears the layer.
  layer.width = MINIMAP_WIDTH * dpr;
  layer.height = MINIMAP_HEIGHT * dpr;
  const context = layer.getContext('2d');
  if (context === null) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const [index, item] of map.items.entries()) {
    const box = toMap(frame, item);
    context.fillStyle =
      item.kind === 'frame' ? colours.section : (map.fills[index] ?? colours.object);
    context.beginPath();
    context.roundRect(box.x, box.y, Math.max(box.width, 1), Math.max(box.height, 1), 1);
    context.fill();
  }
}

/** What {@link draw} keeps between frames: the resolved items and the board's drawn layer. */
interface MapCache {
  map: MapItems | undefined;
  layer: BoardLayer | undefined;
}

/**
 * Draws the map: the board's items, the collaborators' views in their colours, and the person's
 * view. The items are resolved once per change of the board (`cache.map`), and drawn onto a
 * layer that is copied for as long as the map's frame stays, so a camera move inside the board
 * redraws two strokes, not every object.
 *
 * @param canvas - The map's canvas.
 * @param board - The board view.
 * @param camera - The camera.
 * @param theme - The viewer's theme.
 * @param peers - The collaborators, whose views it draws too; none if absent.
 * @param cache - What earlier frames resolved and drew, updated.
 * @returns How the map shows the board, for pointer mapping.
 */
function draw(
  canvas: HTMLCanvasElement,
  board: BoardView,
  camera: Camera,
  theme: ThemeName,
  peers: MinimapPeers | undefined,
  cache: MapCache,
): MinimapFrame {
  const dpr = Math.max(window.devicePixelRatio, 1);
  if (canvas.width !== MINIMAP_WIDTH * dpr) canvas.width = MINIMAP_WIDTH * dpr;
  if (canvas.height !== MINIMAP_HEIGHT * dpr) canvas.height = MINIMAP_HEIGHT * dpr;
  cache.map ??= mapItemsOf(board, theme);
  const map = cache.map;
  const view = viewOf(camera);
  const peerViews =
    peers === undefined ? [] : peerViewsOf(peers.remotePresence(), peers.pageOf(), DEFAULT_PAGE_ID);
  // The map fits the board and the collaborators' views too, so each shows.
  const fitted: WorldRect[] = [...(map.bounds === undefined ? [] : [map.bounds]), ...peerViews];
  const frame = minimapFrame(fitted, view, MINIMAP_WIDTH, MINIMAP_HEIGHT);
  const context = canvas.getContext('2d');
  if (context === null) return frame;
  const style = getComputedStyle(canvas);
  const colours: MinimapColours = {
    section: style.getPropertyValue('--color-line-strong'),
    object: style.getPropertyValue('--color-line-hairline'),
    view: style.getPropertyValue('--color-hand-you'),
  };
  const key = layerKeyOf(frame, dpr);
  if (cache.layer?.key !== key) {
    const layer = cache.layer?.canvas ?? canvas.ownerDocument.createElement('canvas');
    drawBoardLayer(layer, map, frame, dpr, colours);
    cache.layer = { canvas: layer, key };
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(cache.layer.canvas, 0, 0);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const peer of peerViews) strokeView(context, toMap(frame, peer), peer.color, 1);
  strokeView(context, toMap(frame, view), colours.view, 1.5);
  return frame;
}

/**
 * Zooms the view by a wheel on the map, about the board point under the pointer; the page does
 * not scroll (a listener that may prevent it: React's wheel listener is passive).
 *
 * @param canvasRef - The map's canvas.
 * @param frameRef - How the map shows the board, once drawn.
 * @param camera - The camera.
 * @param dispatch - The shell's dispatch.
 */
function useMapWheel(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  frameRef: RefObject<MinimapFrame | undefined>,
  camera: CameraSource,
  dispatch: (action: ShellAction) => void,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const frame = frameRef.current;
      const shown = camera.read();
      if (frame === undefined || shown === undefined) return;
      const rect = canvas.getBoundingClientRect();
      const target = toWorld(frame, event.clientX - rect.left, event.clientY - rect.top);
      // Lines and pages as the canvas's own wheel reads them, the canvas's height a page.
      const deltaYPx = wheelDeltaPx(event.deltaY, event.deltaMode, shown.viewportHeightPx);
      dispatch({ type: 'zoomCamera', ...wheelZoomAt(shown, target, deltaYPx) });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [canvasRef, frameRef, camera, dispatch]);
}

/**
 * The minimap (the design board's Whiteboard page, frame B): the page's top-level
 * objects and what lies on sections drawn small as 1 px-rounded blocks: sections in the strong
 * line colour, stickies in their own colours and anything else in the hairline colour, with the view's rectangle in the accent; pressing or dragging on it moves the view
 * there, at the same zoom (`panCamera`). It redraws at most once a frame, only when the board
 * or the camera changed, and only while it is shown.
 *
 * @param props - The board, the camera and the dispatch.
 * @returns The map.
 */
export function Minimap(props: MinimapProps): ReactElement {
  const { board, camera, dispatch, themeName, peers } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<MinimapFrame | undefined>(undefined);
  useEffect(() => {
    let request: number | undefined;
    // Resolved items and the drawn board, kept while the board, its tokens and the theme stay.
    const cache: MapCache = { map: undefined, layer: undefined };
    const schedule = (): void => {
      request ??= requestAnimationFrame(() => {
        request = undefined;
        const canvas = canvasRef.current;
        const shown = camera.read();
        if (canvas !== null && shown !== undefined)
          frameRef.current = draw(canvas, board, shown, themeName, peers, cache);
      });
    };
    const scheduleBoard = (): void => {
      cache.map = undefined;
      cache.layer = undefined;
      schedule();
    };
    schedule();
    // A selection change alone draws nothing new.
    const stops = [
      camera.subscribe(schedule),
      board.subscribe((change) => {
        if (change.kind === 'document') scheduleBoard();
      }),
    ];
    if (board.subscribeTokens !== undefined) stops.push(board.subscribeTokens(scheduleBoard));
    if (peers !== undefined) stops.push(peers.subscribe(schedule));
    return () => {
      for (const stop of stops) stop();
      if (request !== undefined) cancelAnimationFrame(request);
    };
  }, [board, camera, themeName, peers]);
  useMapWheel(canvasRef, frameRef, camera, dispatch);
  const panTo = (event: PointerEvent<HTMLCanvasElement>): void => {
    const frame = frameRef.current;
    const shown = camera.read();
    if (frame === undefined || shown === undefined) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const target = toWorld(frame, event.clientX - rect.left, event.clientY - rect.top);
    dispatch({ type: 'panCamera', ...panToCentre(shown, target) });
  };
  return (
    <canvas
      ref={canvasRef}
      className={styles.map}
      role="img"
      aria-label="Minimap: press or drag to move the view, scroll to zoom"
      data-minimap=""
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        panTo(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) panTo(event);
      }}
    />
  );
}
