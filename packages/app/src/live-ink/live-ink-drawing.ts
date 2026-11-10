import type { Camera } from '@canvas/engine';
import {
  freehandCurve,
  resolveColor,
  type ColorMode,
  type FreehandObject,
  type FreehandSegment,
  type Point,
  type Rgba,
  type TokenTable,
} from '@canvas/schema';

/** The thinnest a marker draws, as a share of its width: at zero pressure (the engine's). */
const MARKER_MIN_WIDTH_SHARE = 0.3;

/** How long a marker's tapering runs are on screen, CSS px: its width changes every run. */
const TAPER_STEP_PX = 2;

/** The most runs one segment of a marker is drawn in. */
const MAX_TAPER_STEPS = 32;

/** What the drawing needs of a 2D context: the jsdom tests record these calls. */
export type InkContext = Pick<
  CanvasRenderingContext2D,
  | 'setTransform'
  | 'clearRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'bezierCurveTo'
  | 'arc'
  | 'fill'
  | 'stroke'
  | 'drawImage'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'strokeStyle'
  | 'fillStyle'
  | 'globalAlpha'
>;

/** How the pieces are coloured: the viewer's theme, and the board's colour tokens. */
export interface InkPalette {
  /** The viewer's colour mode, for a stroke in a token or the theme's ink. */
  readonly mode: ColorMode;
  /** The board's colour tokens, if it has any. */
  readonly tokens?: TokenTable | undefined;
}

/**
 * A colour as a canvas style, opaque: the stroke's own alpha with the layer's opacity is applied
 * once, when the piece's layer is composited.
 *
 * @param color - The colour, 0 to 1.
 * @returns The style.
 */
function opaqueStyleOf(color: Rgba): string {
  const [red, green, blue] = color;
  return `rgb(${String(Math.round(red * 255))}, ${String(Math.round(green * 255))}, ${String(Math.round(blue * 255))})`;
}

/**
 * How translucent a piece draws: its colour's alpha times its layer opacity.
 *
 * @param piece - The piece.
 * @param color - Its colour, resolved.
 * @returns The alpha, 0 to 1.
 */
export function pieceAlphaOf(piece: FreehandObject, color: Rgba): number {
  return color[3] * (piece.opacity ?? 1);
}

/**
 * Strokes one piece in screen space, CSS px (the context's transform carries the pixel ratio):
 * its curve as cubic segments at the camera, a pencil's and a highlighter's at one width, a
 * marker's tapering from each point's pressure to the next (`strokeTaper`), the ends round (a highlighter's flat) and the
 * turns round; a single point a disc.
 *
 * @param context - The context.
 * @param piece - The piece.
 * @param camera - The camera.
 */
function strokePiece(context: InkContext, piece: FreehandObject, camera: Camera): void {
  const { points, pressures, tool, stroke } = piece;
  const { zoom } = camera;
  const x = (worldX: number): number => (piece.x + worldX - camera.x) * zoom;
  const y = (worldY: number): number => (piece.y + worldY - camera.y) * zoom;
  context.lineJoin = 'round';
  context.lineCap = tool === 'highlighter' ? 'butt' : 'round';
  const segments = freehandCurve(points);
  if (segments.length === 0) {
    const [pointX = 0, pointY = 0] = points;
    context.beginPath();
    context.arc(x(pointX), y(pointY), (stroke.width / 2) * zoom, 0, 2 * Math.PI);
    context.fill();
    return;
  }
  if (tool !== 'marker' || pressures === undefined) {
    context.lineWidth = stroke.width * zoom;
    context.beginPath();
    const first = segments[0];
    if (first !== undefined) context.moveTo(x(first.from.x), y(first.from.y));
    for (const { c1, c2, to } of segments) {
      context.bezierCurveTo(x(c1.x), y(c1.y), x(c2.x), y(c2.y), x(to.x), y(to.y));
    }
    context.stroke();
    return;
  }
  for (const [index, segment] of segments.entries()) {
    strokeTaper(
      context,
      segment,
      [pressures[index] ?? 1, pressures[index + 1] ?? 1],
      (point) => ({
        x: x(point.x),
        y: y(point.y),
      }),
      stroke.width * zoom,
    );
  }
}

/**
 * A point on a cubic segment. Pure.
 *
 * @param segment - The segment.
 * @param t - Where along it, 0 to 1.
 * @returns The point.
 */
function cubicAt(segment: FreehandSegment, t: number): Point {
  const { from, c1, c2, to } = segment;
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * from.x + b * c1.x + c * c2.x + d * to.x,
    y: a * from.y + b * c1.y + c * c2.y + d * to.y,
  };
}

/**
 * Strokes one segment of a marker with its width tapering from one end's pressure to the other's,
 * as the engine's mesh does along the flattened curve (`freehand-mesh.ts`): short straight runs,
 * about every {@link TAPER_STEP_PX} on screen, each at the width its middle is at, with round
 * ends so they join.
 *
 * @param context - The context.
 * @param segment - The segment, in the piece's frame.
 * @param pressures - The pressure at its start and at its end, 0 to 1.
 * @param toScreen - Maps a point of the piece's frame to screen space.
 * @param fullWidth - The width at full pressure, screen px.
 */
function strokeTaper(
  context: InkContext,
  segment: FreehandSegment,
  pressures: readonly [number, number],
  toScreen: (point: Point) => Point,
  fullWidth: number,
): void {
  const start = toScreen(segment.from);
  const end = toScreen(segment.to);
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.min(MAX_TAPER_STEPS, Math.max(1, Math.ceil(length / TAPER_STEP_PX)));
  let previous = start;
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const next = toScreen(cubicAt(segment, t));
    const middle = (step - 0.5) / steps;
    const pressure = pressures[0] + (pressures[1] - pressures[0]) * middle;
    context.lineWidth =
      fullWidth * (MARKER_MIN_WIDTH_SHARE + (1 - MARKER_MIN_WIDTH_SHARE) * pressure);
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    previous = next;
  }
}

/**
 * Draws the stroke under way over the board: each piece at the camera, in device px.
 * An opaque piece is drawn straight onto the overlay; a translucent one is drawn opaque onto the
 * layer, which is then composited once at its alpha, so a stroke crossing itself never darkens
 * (as the engine's `strokeOnce` draws it).
 *
 * @param target - The overlay's context.
 * @param layer - A context the overlay's size for translucent pieces, and its canvas.
 * @param layer.context - Its context.
 * @param layer.canvas - Its canvas, composited onto the overlay.
 * @param pieces - The pieces, world units.
 * @param camera - The camera, CSS px.
 * @param size - The overlay's size, device px, and its pixel ratio.
 * @param size.width - Its width, device px.
 * @param size.height - Its height, device px.
 * @param size.dpr - Device px per CSS px.
 * @param palette - How strokes are coloured.
 */
export function drawLiveInk(
  target: InkContext,
  layer: { readonly context: InkContext; readonly canvas: CanvasImageSource } | undefined,
  pieces: readonly FreehandObject[],
  camera: Camera,
  size: { readonly width: number; readonly height: number; readonly dpr: number },
  palette: InkPalette,
): void {
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.clearRect(0, 0, size.width, size.height);
  for (const piece of pieces) {
    const color = resolveColor(piece.stroke.color, palette.mode, palette.tokens);
    const alpha = pieceAlphaOf(piece, color);
    const isTranslucent = alpha < 1 && layer !== undefined;
    const context = isTranslucent ? layer.context : target;
    if (isTranslucent) {
      layer.context.setTransform(1, 0, 0, 1, 0, 0);
      layer.context.clearRect(0, 0, size.width, size.height);
    }
    context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    context.strokeStyle = opaqueStyleOf(color);
    context.fillStyle = opaqueStyleOf(color);
    strokePiece(context, piece, camera);
    if (isTranslucent) {
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalAlpha = alpha;
      target.drawImage(layer.canvas, 0, 0);
      target.globalAlpha = 1;
    }
  }
}
