// The 2D canvas a colour glyph is rasterised with: a browser OffscreenCanvas in a job
// worker satisfies it; tests pass a recording fake. Only the calls `rasterColourGlyph` makes.

/** An image the canvas can draw: opaque here, made by `ColourCanvasFactory.decodePng`. */
export type ColourImage = unknown;

/** A canvas gradient: colour stops along it. */
export interface ColourGradient {
  /**
   * Adds a stop.
   *
   * @param offset - Where along the gradient, 0..1.
   * @param color - A CSS colour.
   */
  addColorStop(offset: number, color: string): void;
}

/** A 2D affine transform, as the canvas reports it. */
export interface ColourMatrix {
  /** x scale. */
  readonly a: number;
  /** y shear from x. */
  readonly b: number;
  /** x shear from y. */
  readonly c: number;
  /** y scale. */
  readonly d: number;
  /** x translation. */
  readonly e: number;
  /** y translation. */
  readonly f: number;
}

/** A canvas's pixels, as `ImageData` holds them. */
export interface ColourPixels {
  /** RGBA, straight alpha, rows top to bottom. */
  readonly data: Uint8ClampedArray;
}

/** The part of `OffscreenCanvasRenderingContext2D` a colour glyph uses. */
export interface ColourContext2d {
  /** The paint for fills: a CSS colour or a gradient. */
  fillStyle: unknown;
  /** How later draws composite. */
  globalCompositeOperation: string;
  /** Pushes the drawing state. */
  save(): void;
  /** Pops the drawing state. */
  restore(): void;
  /**
   * Multiplies the transform by a matrix.
   *
   * @param a - x scale.
   * @param b - y shear from x.
   * @param c - x shear from y.
   * @param d - y scale.
   * @param e - x translation.
   * @param f - y translation.
   */
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  /**
   * Replaces the transform.
   *
   * @param a - x scale.
   * @param b - y shear from x.
   * @param c - x shear from y.
   * @param d - y scale.
   * @param e - x translation.
   * @param f - y translation.
   */
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  /**
   * The current transform.
   *
   * @returns The matrix.
   */
  getTransform(): ColourMatrix;
  /** Starts a new path. */
  beginPath(): void;
  /**
   * Starts a contour.
   *
   * @param x - x.
   * @param y - y.
   */
  moveTo(x: number, y: number): void;
  /**
   * Adds a line.
   *
   * @param x - The end's x.
   * @param y - The end's y.
   */
  lineTo(x: number, y: number): void;
  /**
   * Adds a quadratic Bézier.
   *
   * @param cx - The control point's x.
   * @param cy - The control point's y.
   * @param x - The end's x.
   * @param y - The end's y.
   */
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  /**
   * Adds a cubic Bézier.
   *
   * @param c1x - The first control point's x.
   * @param c1y - The first control point's y.
   * @param c2x - The second control point's x.
   * @param c2y - The second control point's y.
   * @param x - The end's x.
   * @param y - The end's y.
   */
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  /** Closes the contour. */
  closePath(): void;
  /**
   * Adds a rectangle contour.
   *
   * @param x - Left.
   * @param y - Top.
   * @param width - Width.
   * @param height - Height.
   */
  rect(x: number, y: number, width: number, height: number): void;
  /**
   * Intersects the clip with the path.
   *
   * @param fillRule - Always nonzero.
   */
  clip(fillRule: 'nonzero'): void;
  /**
   * Fills a rectangle with the fill style.
   *
   * @param x - Left.
   * @param y - Top.
   * @param width - Width.
   * @param height - Height.
   */
  fillRect(x: number, y: number, width: number, height: number): void;
  /**
   * Clears a rectangle to transparent.
   *
   * @param x - Left.
   * @param y - Top.
   * @param width - Width.
   * @param height - Height.
   */
  clearRect(x: number, y: number, width: number, height: number): void;
  /**
   * A linear gradient.
   *
   * @param x0 - The start's x.
   * @param y0 - The start's y.
   * @param x1 - The end's x.
   * @param y1 - The end's y.
   * @returns The gradient.
   */
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): ColourGradient;
  /**
   * A two-circle radial gradient.
   *
   * @param x0 - The start circle's centre x.
   * @param y0 - The start circle's centre y.
   * @param r0 - The start circle's radius.
   * @param x1 - The end circle's centre x.
   * @param y1 - The end circle's centre y.
   * @param r1 - The end circle's radius.
   * @returns The gradient.
   */
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): ColourGradient;
  /**
   * A conic gradient.
   *
   * @param startAngle - Where share 0 sits, in radians from +x.
   * @param x - The centre's x.
   * @param y - The centre's y.
   * @returns The gradient.
   */
  createConicGradient(startAngle: number, x: number, y: number): ColourGradient;
  /**
   * Draws an image or another canvas.
   *
   * @param image - What to draw.
   * @param dx - Left.
   * @param dy - Top.
   * @param dw - Width; the image's own by default.
   * @param dh - Height; the image's own by default.
   */
  drawImage(image: unknown, dx: number, dy: number, dw?: number, dh?: number): void;
  /**
   * A transparent pixel buffer to write and put back.
   *
   * @param width - Width, in px.
   * @param height - Height, in px.
   * @returns The buffer: RGBA, straight alpha.
   */
  createImageData(width: number, height: number): ColourPixels;
  /**
   * Writes a pixel buffer from `createImageData` into the canvas, ignoring transform and clip.
   *
   * @param image - The buffer.
   * @param dx - Left, in px.
   * @param dy - Top, in px.
   */
  putImageData(image: unknown, dx: number, dy: number): void;
  /**
   * Reads pixels back, straight alpha.
   *
   * @param x - Left, in px.
   * @param y - Top, in px.
   * @param width - Width, in px.
   * @param height - Height, in px.
   * @returns The RGBA bytes.
   */
  getImageData(x: number, y: number, width: number, height: number): ColourPixels;
}

/** A canvas of a size, with its 2D context. */
export interface ColourCanvas {
  /** Width, in px. */
  readonly width: number;
  /** Height, in px. */
  readonly height: number;
  /**
   * Its 2D context.
   *
   * @param type - Always `'2d'`.
   * @returns The context, or null where there is none.
   */
  getContext(type: '2d'): ColourContext2d | null;
}

/** Makes the canvases and images a colour glyph needs; a job worker's OffscreenCanvas. */
export interface ColourCanvasFactory {
  /**
   * A transparent canvas.
   *
   * @param width - Width, in px.
   * @param height - Height, in px.
   * @returns The canvas.
   */
  create(width: number, height: number): ColourCanvas;
  /**
   * Decodes a PNG for drawing.
   *
   * @param bytes - The PNG file.
   * @returns The image.
   */
  decodePng(bytes: Uint8Array): Promise<ColourImage>;
}
