// A path's network from SVG path data: what `create_objects` and `editNetwork` do with
// a `d`. The data is read in the path's own frame exactly as written, each subpath its own chain
// or loop (`subpathsToNetwork`), and drawn as the board draws a network: it fills only loops,
// even-odd. So an open subpath stays open whatever the paint, which keeps every network the board
// holds writable as path data and read back the same (`networkToPathData`, `query_board`'s
// `pathData`); where SVG would fill it (closed implicitly) or would fill nonzero differently, the
// difference is reported. Pure.
import type { Segment, Vertex } from '../objects/path-network.js';

import { nonzeroDiffersFromEvenOdd } from './svg-fill-rule.js';
import { hasOpenSubpath, subpathsToNetwork } from './svg-network.js';
import { readPathData } from './svg-path-data.js';

/** The longest path data a path may be given, characters. */
export const PATH_DATA_MAX_LENGTH = 65_536;

/** What the path is painted with, which decides what is reported. */
export interface PathDataPaint {
  /** Whether the path has a fill. */
  readonly isFilled: boolean;
}

/** A path's network read from path data, or why it could not be. */
export type PathDataNetwork =
  | {
      /** The data was read. */
      readonly isRead: true;
      /** The vertices, ids `v0`, `v1`, …, in the path's own frame. */
      readonly vertices: Vertex[];
      /** The segments, ids `s0`, `s1`, … . */
      readonly segments: Segment[];
      /**
       * Why the board's even-odd fill may differ from SVG's nonzero, or undefined when it does
       * not (or the path has no fill).
       */
      readonly fillRule: string | undefined;
      /** Whether the path is filled and has an open subpath, which SVG would fill and the board does not. */
      readonly hasOpenUnderFill: boolean;
    }
  | {
      /** The data was refused. */
      readonly isRead: false;
      /** Why, naming the character offset of a syntax error. */
      readonly problem: string;
    };

/**
 * Reads SVG path data into a path's vector network, in the path's own frame as written, each open
 * subpath left open. Refuses data over {@link PATH_DATA_MAX_LENGTH}, malformed data (the problem
 * names the character offset) and data that draws nothing.
 *
 * @param data - The path data; not mutated.
 * @param paint - Whether the path is filled.
 * @returns The network, or the problem.
 */
export function pathDataToNetwork(data: string, paint: PathDataPaint): PathDataNetwork {
  if (data.length > PATH_DATA_MAX_LENGTH) {
    return {
      isRead: false,
      problem: `path data is ${String(data.length)} characters, over the ${String(PATH_DATA_MAX_LENGTH)} a path may be given`,
    };
  }
  const read = readPathData(data);
  if (read.error !== undefined) return { isRead: false, problem: `path data: ${read.error}` };
  const network = subpathsToNetwork(read.subpaths, false);
  if (network.segments.length === 0) {
    return { isRead: false, problem: 'the path data draws nothing' };
  }
  // The board fills the loops alone: only they decide whether nonzero would fill differently.
  const loops = read.subpaths.filter(({ isClosed }) => isClosed);
  const isDifferent = paint.isFilled && loops.length > 0 ? nonzeroDiffersFromEvenOdd(loops) : false;
  return {
    isRead: true,
    vertices: network.vertices,
    segments: network.segments,
    fillRule:
      isDifferent === false
        ? undefined
        : isDifferent === undefined
          ? 'too complex to check; nonzero is drawn even-odd'
          : 'overlapping or self-crossing outlines are filled even-odd, not nonzero',
    hasOpenUnderFill: paint.isFilled && hasOpenSubpath(read.subpaths),
  };
}
