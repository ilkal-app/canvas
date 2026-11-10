import type { BoardObject, PathObject } from '@canvas/schema';

import { readFill } from '../paint/paint-reading.js';

import { closedLoops } from './chains.js';
import { indexNetwork } from './network-index.js';

/**
 * One thing a path draws, with a record of its own in the path pass: its even-odd `fill`, or
 * its `stroke`. The record holds the layer's colour, so the pass draws a layer by selecting its
 * record with `firstInstance`.
 */
export type PathLayer = 'fill' | 'stroke';

const NO_LAYERS: readonly PathLayer[] = [];

/** A line's or connector's one layer: its shaft and heads, stroked in its stroke colour. */
const LINE_LAYERS: readonly PathLayer[] = ['stroke'];

/** Layers per path value: objects are immutable values, so a change arrives as a new one. */
const layersByPath = new WeakMap<PathObject, readonly PathLayer[]>();

/**
 * Whether a path has a closed loop to fill: a component whose vertices all have exactly two
 * segments (a branching network is stroked, never filled).
 *
 * @param path - The path.
 * @returns True when it has one.
 */
function hasClosedLoop(path: PathObject): boolean {
  return closedLoops(indexNetwork(path)).length > 0;
}

/**
 * The layers a path draws, fill first so its stroke paints over it (the prototype's order): a
 * fill when it has a fill colour and a closed loop, a stroke when it has a stroke and a vertex. A
 * line or a connector draws one stroke layer, its heads included: the path
 * pass draws them too. Pure
 * and memoised per object value, since the scene asks on every change and the z-order segments
 * stage on every rebuild of its occluder table.
 *
 * @param object - Any board object.
 * @returns The layers; none for anything but a path, a line or a connector, or a path that
 *   draws nothing.
 */
export function pathLayersOf(object: BoardObject): readonly PathLayer[] {
  // A freehand stroke is one stroke layer too.
  if (object.type === 'line' || object.type === 'connector' || object.type === 'freehand') {
    return LINE_LAYERS;
  }
  if (object.type !== 'path') return NO_LAYERS;
  let layers = layersByPath.get(object);
  if (!layers) {
    const found: PathLayer[] = [];
    if (readFill(object.fill) !== null && hasClosedLoop(object)) found.push('fill');
    if (object.stroke !== null && object.vertices.length > 0) found.push('stroke');
    layers = found;
    layersByPath.set(object, layers);
  }
  return layers;
}
