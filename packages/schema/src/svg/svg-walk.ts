// The shared state of one SVG import: what it made, what it reported, and the caps it
// counts against. Pure.
import type { Rgba } from '../fields/color.js';
import type { PathObject } from '../objects/path-object.js';
import type { ShapeObject } from '../objects/shape-object.js';

import { SVG_IMPORT_LIMITS } from './svg-limits.js';
import type { SvgIssue } from './svg-paint.js';
import type { SvgElement } from './svg-xml.js';

/** A path object an import makes: the fields of its own, placed in the group's frame. */
export type SvgImportedPath = Pick<
  PathObject,
  | 'type'
  | 'x'
  | 'y'
  | 'rotation'
  | 'vertices'
  | 'segments'
  | 'stroke'
  | 'strokeDash'
  | 'strokeJoin'
  | 'strokeMiterLimit'
  | 'strokeCap'
  | 'fill'
>;

/** A shape object an import makes: the fields of its own, placed in the group's frame. */
export type SvgImportedShape = Pick<
  ShapeObject,
  | 'type'
  | 'x'
  | 'y'
  | 'rotation'
  | 'width'
  | 'height'
  | 'kind'
  | 'stroke'
  | 'fill'
  | 'cornerRadius'
  | 'sides'
  | 'label'
>;

/** An object an import makes. */
export type SvgImportedObject = SvgImportedPath | SvgImportedShape;

/** Something drawn differently from the SVG or left out, with how often it happened. */
export interface SvgImportIssue extends SvgIssue {
  /** How many times, over the whole document. */
  readonly count: number;
}

/** Relative tolerance for "equal" scales and "orthogonal" axes. */
export const TOLERANCE = 1e-9;

/** How a document is being walked: the shared state of one import. */
export interface Walk {
  /** The document's elements by id. */
  readonly ids: ReadonlyMap<string, SvgElement>;
  /** The objects made so far, bottom first. */
  readonly objects: SvgImportedObject[];
  /** The issues so far, by feature and detail. */
  readonly issues: Map<string, { feature: string; detail: string; count: number }>;
  /** What `currentColor` is at the root. */
  readonly currentColor: Rgba;
  /** Elements visited so far, `<use>` expansions included. */
  visited: number;
  /** How deep the drawing is nested now, `<use>` expansions included. */
  depth: number;
  /** The edge operations the fill-rule check may still spend. */
  readonly fillRuleBudget: { remaining: number };
  /** Path vertices made so far. */
  vertices: number;
  /** The ids of the `<use>` targets being drawn, to stop a reference cycle. */
  readonly using: string[];
}

/** Refuses the whole import. */
export class ImportRefusal extends Error {}

/**
 * Records an issue, counting repeats of the same feature and detail.
 *
 * @param walk - The walk.
 * @param issue - The issue.
 */
export function report(walk: Walk, issue: SvgIssue): void {
  const key = `${issue.feature}: ${issue.detail}`;
  const known = walk.issues.get(key);
  if (known === undefined) walk.issues.set(key, { ...issue, count: 1 });
  else known.count += 1;
}

/**
 * Adds an object, refusing the import past the object or vertex cap.
 *
 * @param walk - The walk.
 * @param object - The object.
 * @throws {ImportRefusal} Past the object or vertex cap.
 */
export function add(walk: Walk, object: SvgImportedObject): void {
  if (walk.objects.length >= SVG_IMPORT_LIMITS.maxObjects) {
    throw new ImportRefusal(
      `the SVG draws more than ${String(SVG_IMPORT_LIMITS.maxObjects)} objects`,
    );
  }
  if (object.type === 'path') walk.vertices += object.vertices.length;
  if (walk.vertices > SVG_IMPORT_LIMITS.maxVertices) {
    throw new ImportRefusal(
      `the SVG has more than ${String(SVG_IMPORT_LIMITS.maxVertices)} vertices`,
    );
  }
  walk.objects.push(object);
}
