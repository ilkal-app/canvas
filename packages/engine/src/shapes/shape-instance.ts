import type { StrokeAlign } from '@canvas/schema';

/**
 * Which signed-distance function a shape instance is drawn with, each inscribed in its rect: a
 * rectangle with rounded corners (note fills, note shadows, rectangle shapes), an ellipse, a
 * diamond, a regular polygon or a star (`sides` of them) stretched to fill the rect.
 */
export type ShapeKind = 'rounded-box' | 'ellipse' | 'diamond' | 'polygon' | 'star';

/**
 * A colour as `[red, green, blue, alpha]`, each in [0, 1], with straight (not premultiplied)
 * alpha. The shape shader premultiplies it, as every prototype renderer did.
 */
export type ShapeColor = readonly [number, number, number, number];

/**
 * A shape's outline: drawn inside its edge by default, so the shape never grows past its rect,
 * or centred on it or outside it.
 */
export interface ShapeStroke {
  /** The outline's colour, straight alpha. */
  readonly color: ShapeColor;
  /** Its width, world units; 0 draws none. */
  readonly width: number;
  /** Where it lies about the edge; inside when absent. */
  readonly align?: StrokeAlign;
}

/** An axis-aligned rectangle in world units, from its top-left corner. */
export interface ShapeRect {
  /** Left edge, in world units. */
  readonly x: number;
  /** Top edge, in world units. */
  readonly y: number;
  /** Width, in world units; not negative. */
  readonly width: number;
  /** Height, in world units; not negative. */
  readonly height: number;
}

/**
 * One SDF shape quad: a rounded box or an
 * ellipse filling `rect`, turned about its top-left corner, with an optional soft edge. All
 * lengths are world units, so a shape and its blur scale with zoom. Every number must be finite, and sizes, `radius` and
 * `softness` not negative; the packer does not check (it is on the per-frame path), and what
 * other values draw is undefined.
 */
export interface ShapeInstance extends ShapeRect {
  /** The distance function the fragment shader evaluates. */
  readonly kind: ShapeKind;
  /** The fill colour, straight alpha. */
  readonly color: ShapeColor;
  /**
   * Corner radius, in world units; clamped by the shader to half the shorter side. Ignored by
   * ellipses.
   */
  readonly radius: number;
  /**
   * Half-width of the blurred edge, in world units: coverage falls from 1 at `softness` inside
   * the outline to 0 at `softness` outside it. 0 draws a crisp edge antialiased over about one
   * device pixel at any zoom.
   */
  readonly softness: number;
  /**
   * How far the shape is turned about its rect's top-left corner `(x, y)`, radians clockwise
   * (y down), so a shape turns with its object; 0 when absent.
   */
  readonly rotation?: number;
  /** A polygon's sides or a star's points, 3 to 64; ignored by the other kinds. */
  readonly sides?: number;
  /**
   * The outline, laid over the fill inside the edge; none when absent. A shape with only
   * an outline has a fully transparent `color`.
   */
  readonly stroke?: ShapeStroke;
}
