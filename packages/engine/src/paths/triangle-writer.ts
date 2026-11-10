/** Floats a writer starts with: 16 triangles. */
const INITIAL_FLOATS = 96;

/**
 * A growable triangle list of `x, y` pairs, three vertices per triangle, so a mesh builder
 * writes triangles without allocating an object per point. Grows by doubling.
 */
export class TriangleWriter {
  private data: Float32Array<ArrayBuffer>;
  private used = 0;

  /**
   * Creates an empty writer.
   *
   * @param initialFloats - Room to start with, in floats (six per triangle).
   */
  constructor(initialFloats = INITIAL_FLOATS) {
    this.data = new Float32Array(Math.max(6, initialFloats));
  }

  /**
   * The floats written so far.
   *
   * @returns Six per triangle.
   */
  get floatLength(): number {
    return this.used;
  }

  /**
   * The vertices written so far.
   *
   * @returns Three per triangle.
   */
  get vertexCount(): number {
    return this.used / 2;
  }

  /**
   * Appends one triangle.
   *
   * @param ax - First vertex x.
   * @param ay - First vertex y.
   * @param bx - Second vertex x.
   * @param by - Second vertex y.
   * @param cx - Third vertex x.
   * @param cy - Third vertex y.
   */
  triangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void {
    if (this.used + 6 > this.data.length) this.grow(this.used + 6);
    const { data } = this;
    const at = this.used;
    data[at] = ax;
    data[at + 1] = ay;
    data[at + 2] = bx;
    data[at + 3] = by;
    data[at + 4] = cx;
    data[at + 5] = cy;
    this.used = at + 6;
  }

  /**
   * Appends another triangle list as it is.
   *
   * @param triangles - Six floats per triangle.
   */
  append(triangles: Float32Array): void {
    if (this.used + triangles.length > this.data.length) this.grow(this.used + triangles.length);
    this.data.set(triangles, this.used);
    this.used += triangles.length;
  }

  /**
   * A copy of what was written, exactly as long as it.
   *
   * @returns The triangle list.
   */
  toFloat32Array(): Float32Array<ArrayBuffer> {
    return this.data.slice(0, this.used);
  }

  private grow(minimum: number): void {
    let length = this.data.length * 2;
    while (length < minimum) length *= 2;
    const grown = new Float32Array(length);
    grown.set(this.data.subarray(0, this.used));
    this.data = grown;
  }
}
