// SVG path data (SVG 2 §9.3, "The grammar for path data"): every command, absolute and
// relative, with implicit repeats and compact numbers (`M.5.5`, `a1 1 0 00 1 1`), read into
// subpaths of lines and cubics. Quadratics become cubics exactly; arcs become cubics of at most a
// quarter turn each (SVG 2 Appendix B.2, endpoint to centre parameterisation). On an error the
// commands before it are kept, as SVG renders them, and the error is reported. Pure.
import type { Point } from '../fields/point.js';

import type { OutlinePiece, Subpath } from './svg-geometry.js';

/** Path data read into subpaths, and the first error, if any. */
export interface PathData {
  /** The subpaths drawn before any error; a subpath with nothing drawn is left out. */
  readonly subpaths: readonly Subpath[];
  /** The first error, where the rest of the data was ignored; undefined when all of it was read. */
  readonly error: string | undefined;
}

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const SEPARATORS = /[\s,]*/y;
/** How many numbers each command takes per repeat; `A` takes seven, two of them flags. */
const ARITY: Readonly<Record<string, number>> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

/**
 * The signed angle from `u` to `v`, radians.
 *
 * @param ux - u's x.
 * @param uy - u's y.
 * @param vx - v's x.
 * @param vy - v's y.
 * @returns The angle in [−π, π].
 */
function angleBetween(ux: number, uy: number, vx: number, vy: number): number {
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

/**
 * An elliptical arc as cubics (SVG 2 Appendix B.2.4 and B.2.5): radii scaled up when too small,
 * at most a quarter turn per cubic. Equal ends draw nothing; a zero radius draws a line.
 *
 * @param from - The current point.
 * @param radii - `rx`, `ry` as written; their signs are ignored.
 * @param rotationDeg - The ellipse's x-axis rotation, degrees.
 * @param isLargeArc - The large-arc flag.
 * @param isSweep - The sweep flag.
 * @param to - The end point.
 * @returns The pieces.
 */
export function arcToPieces(
  from: Point,
  radii: Point,
  rotationDeg: number,
  isLargeArc: boolean,
  isSweep: boolean,
  to: Point,
): OutlinePiece[] {
  if (from.x === to.x && from.y === to.y) return [];
  let rx = Math.abs(radii.x);
  let ry = Math.abs(radii.y);
  if (rx === 0 || ry === 0) return [{ kind: 'line', to }];
  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const hx = (from.x - to.x) / 2;
  const hy = (from.y - to.y) / 2;
  const x1 = cos * hx + sin * hy;
  const y1 = -sin * hx + cos * hy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const root = Math.sqrt(Math.max(0, numerator / denominator));
  const sign = isLargeArc === isSweep ? -1 : 1;
  const cx1 = (sign * root * rx * y1) / ry;
  const cy1 = (-sign * root * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2;
  const ux = (x1 - cx1) / rx;
  const uy = (y1 - cy1) / ry;
  const start = angleBetween(1, 0, ux, uy);
  let turn = angleBetween(ux, uy, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!isSweep && turn > 0) turn -= 2 * Math.PI;
  if (isSweep && turn < 0) turn += 2 * Math.PI;
  const count = Math.max(1, Math.ceil(Math.abs(turn) / (Math.PI / 2) - 1e-9));
  const step = turn / count;
  const k = (4 / 3) * Math.tan(step / 4);
  // A unit-circle point onto the ellipse: scale by the radii, rotate by phi, move to the centre.
  const place = (x: number, y: number): Point => ({
    x: cx + cos * rx * x - sin * ry * y,
    y: cy + sin * rx * x + cos * ry * y,
  });
  return Array.from({ length: count }, (unused, index): OutlinePiece => {
    const t1 = start + index * step;
    const t2 = t1 + step;
    return {
      kind: 'cubic',
      c1: place(Math.cos(t1) - k * Math.sin(t1), Math.sin(t1) + k * Math.cos(t1)),
      c2: place(Math.cos(t2) + k * Math.sin(t2), Math.sin(t2) - k * Math.cos(t2)),
      to: index === count - 1 ? to : place(Math.cos(t2), Math.sin(t2)),
    };
  });
}

/** Reads path data left to right, keeping what was drawn before an error. */
class PathReader {
  private position = 0;
  private readonly subpaths: Subpath[] = [];
  private start: Point = { x: 0, y: 0 };
  private point: Point = { x: 0, y: 0 };
  private pieces: OutlinePiece[] = [];
  /** The previous command, lowercase, for `S` and `T` reflection and implicit repeats. */
  private previous = '';
  /** The previous `C`/`S` second control point or `Q`/`T` control point. */
  private control: Point = { x: 0, y: 0 };

  constructor(private readonly data: string) {}

  read(): PathData {
    let error: string | undefined;
    let command = '';
    this.skipSeparators();
    while (this.position < this.data.length) {
      const char = this.data.charAt(this.position);
      if (/[MmLlHhVvCcSsQqTtAaZz]/.test(char)) {
        command = char;
        this.position += 1;
      } else if (command === '' || command === 'z' || command === 'Z' || !/[\d.+-]/.test(char)) {
        error = `unexpected "${char}" at offset ${String(this.position)}`;
        break;
      } else if (command === 'M' || command === 'm') {
        // Pairs after a moveto are implicit linetos.
        command = command === 'M' ? 'L' : 'l';
      }
      if (this.previous === '' && command !== 'M' && command !== 'm') {
        error = `path data must start with a moveto, not "${command}", at offset ${String(this.position - 1)}`;
        break;
      }
      const args = this.readArguments(command);
      if (args === undefined) {
        error = `command "${command}" is missing numbers at offset ${String(this.position)}`;
        break;
      }
      this.apply(command, args);
      this.skipSeparators();
    }
    this.flush(false);
    return { subpaths: this.subpaths, error };
  }

  private skipSeparators(): void {
    SEPARATORS.lastIndex = this.position;
    SEPARATORS.exec(this.data);
    this.position = SEPARATORS.lastIndex;
  }

  private readArguments(command: string): number[] | undefined {
    const lower = command.toLowerCase();
    const arity = Number(ARITY[lower]);
    const args: number[] = [];
    for (let index = 0; index < arity; index += 1) {
      if (index > 0) this.skipSeparators();
      const isFlag = lower === 'a' && (index === 3 || index === 4);
      const value = isFlag ? this.readFlag() : this.readNumber();
      if (value === undefined) return undefined;
      args.push(value);
    }
    return args;
  }

  private readNumber(): number | undefined {
    NUMBER.lastIndex = this.position;
    const match = NUMBER.exec(this.data);
    if (match === null) return undefined;
    this.position = NUMBER.lastIndex;
    return Number(match[0]);
  }

  private readFlag(): number | undefined {
    const char = this.data.charAt(this.position);
    if (char !== '0' && char !== '1') return undefined;
    this.position += 1;
    return Number(char);
  }

  /**
   * Ends the current subpath; one that drew nothing is dropped.
   *
   * @param isClosed - Whether a closepath ended it.
   */
  private flush(isClosed: boolean): void {
    if (this.pieces.length > 0) {
      this.subpaths.push({ start: this.start, pieces: this.pieces, isClosed });
    }
    this.pieces = [];
  }

  private apply(command: string, args: readonly number[]): void {
    const lower = command.toLowerCase();
    const isRelative = command === lower;
    const base = isRelative ? this.point : { x: 0, y: 0 };
    // Every command's arguments were read in full, so each index is there.
    const arg = (index: number): number => Number(args[index]);
    const at = (index: number): Point => ({ x: base.x + arg(index), y: base.y + arg(index + 1) });
    const value = arg(0);
    const previous = this.previous;
    this.previous = lower;
    switch (lower) {
      case 'm':
        this.flush(false);
        this.start = at(0);
        this.point = this.start;
        return;
      case 'z':
        this.flush(true);
        this.point = this.start;
        return;
      case 'l': {
        this.line(at(0));
        return;
      }
      case 'h': {
        this.line({ x: (isRelative ? this.point.x : 0) + value, y: this.point.y });
        return;
      }
      case 'v': {
        this.line({ x: this.point.x, y: (isRelative ? this.point.y : 0) + value });
        return;
      }
      case 'c': {
        this.cubic(at(0), at(2), at(4));
        return;
      }
      case 's': {
        this.cubic(this.reflected(previous, 'cs'), at(0), at(2));
        return;
      }
      case 'q': {
        this.quadratic(at(0), at(2));
        return;
      }
      case 't': {
        this.quadratic(this.reflected(previous, 'qt'), at(0));
        return;
      }
      default:
        this.draw(
          arcToPieces(
            this.point,
            { x: value, y: arg(1) },
            arg(2),
            args[3] === 1,
            args[4] === 1,
            at(5),
          ),
          at(5),
        );
    }
  }

  /**
   * The previous control point reflected about the current point, if `previous` is one of `kinds`.
   *
   * @param previous - The previous command, lowercase.
   * @param kinds - The commands whose control point reflects (`cs` or `qt`).
   * @returns The reflected point, or the current point.
   */
  private reflected(previous: string, kinds: string): Point {
    if (previous === '' || !kinds.includes(previous)) return this.point;
    return { x: 2 * this.point.x - this.control.x, y: 2 * this.point.y - this.control.y };
  }

  private draw(pieces: readonly OutlinePiece[], to: Point): void {
    // After a closepath, drawing continues a new subpath from the closed one's start.
    this.pieces.push(...pieces);
    this.point = to;
    this.control = to;
  }

  private line(to: Point): void {
    this.draw([{ kind: 'line', to }], to);
  }

  private cubic(c1: Point, c2: Point, to: Point): void {
    this.draw([{ kind: 'cubic', c1, c2, to }], to);
    this.control = c2;
  }

  private quadratic(control: Point, to: Point): void {
    const from = this.point;
    const c1 = {
      x: from.x + (2 / 3) * (control.x - from.x),
      y: from.y + (2 / 3) * (control.y - from.y),
    };
    const c2 = { x: to.x + (2 / 3) * (control.x - to.x), y: to.y + (2 / 3) * (control.y - to.y) };
    this.draw([{ kind: 'cubic', c1, c2, to }], to);
    this.control = control;
  }
}

/**
 * Reads SVG path data into subpaths of lines and cubics in the element's user space.
 *
 * @param data - The `d` attribute; not mutated.
 * @returns The subpaths drawn before any error, and the error.
 */
export function readPathData(data: string): PathData {
  return new PathReader(data).read();
}
