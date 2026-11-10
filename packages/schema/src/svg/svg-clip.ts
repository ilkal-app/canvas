// Filters, masks and clipping: the board applies none of them, so each is reported,
// except a clip that clips nothing (the rectangle design tools put round a whole icon). Pure.
import type { Point } from '../fields/point.js';
import { mapPoint, type AffineMap } from '../geometry/affine-map.js';
import { pathBounds, type Rect } from '../geometry/local-bounds.js';

import { lengths } from './svg-outline.js';
import type { SvgStyle } from './svg-style.js';
import { report, type SvgImportedObject, type Walk } from './svg-walk.js';

/**
 * The bounds of an object in the group's frame: a path's vertices and handles widened by half its
 * stroke, a shape's turned box (its stroke lies inside it).
 *
 * @param object - The object.
 * @returns The bounds.
 */
function objectBounds(object: SvgImportedObject): Rect {
  let corners: Point[];
  if (object.type === 'path') {
    const box = pathBounds(object);
    const half = (object.stroke?.width ?? 0) / 2;
    const left = object.x + box.x - half;
    const top = object.y + box.y - half;
    corners = [
      { x: left, y: top },
      { x: left + box.width + 2 * half, y: top + box.height + 2 * half },
    ];
  } else {
    const cos = Math.cos(object.rotation);
    const sin = Math.sin(object.rotation);
    corners = [
      [0, 0],
      [object.width, 0],
      [0, object.height],
      [object.width, object.height],
    ].map(([u = 0, v = 0]) => ({
      x: object.x + u * cos - v * sin,
      y: object.y + u * sin + v * cos,
    }));
  }
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Tells whether a `clip-path` clips nothing: a `<clipPath>` of one sharp, untransformed rectangle
 * in user space, under an unrotated map, containing everything it clips (the clip a design tool
 * puts round a whole icon).
 *
 * @param value - The `clip-path` value.
 * @param ctm - The clipped element's map.
 * @param objects - What the element drew.
 * @param walk - The walk.
 * @returns True when the clip changes nothing.
 */
function clipsNothing(
  value: string,
  ctm: AffineMap,
  objects: readonly SvgImportedObject[],
  walk: Walk,
): boolean {
  const id = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)$/.exec(value.trim())?.[1] ?? '';
  const clip = walk.ids.get(id);
  const rect = clip?.children[0];
  if (
    clip?.name !== 'clipPath' ||
    clip.attributes.get('clipPathUnits') === 'objectBoundingBox' ||
    clip.attributes.has('transform') ||
    clip.children.length !== 1 ||
    rect?.name !== 'rect' ||
    rect.attributes.has('transform') ||
    rect.attributes.has('rx') ||
    rect.attributes.has('ry') ||
    ctm.b !== 0 ||
    ctm.c !== 0
  ) {
    return false;
  }
  const quiet: Walk = { ...walk, issues: new Map() };
  const [x = 0, y = 0, width = 0, height = 0] =
    lengths(
      rect,
      [
        ['x', 0],
        ['y', 0],
        ['width', 0],
        ['height', 0],
      ],
      quiet,
    ) ?? [];
  const p = mapPoint(ctm, { x, y });
  const q = mapPoint(ctm, { x: x + width, y: y + height });
  const slack = 1e-9 * Math.max(1, Math.abs(p.x), Math.abs(p.y), Math.abs(q.x), Math.abs(q.y));
  const [left, right] = [Math.min(p.x, q.x) - slack, Math.max(p.x, q.x) + slack];
  const [top, bottom] = [Math.min(p.y, q.y) - slack, Math.max(p.y, q.y) + slack];
  return objects.every((object) => {
    const bounds = objectBounds(object);
    return (
      bounds.x >= left &&
      bounds.y >= top &&
      bounds.x + bounds.width <= right &&
      bounds.y + bounds.height <= bottom
    );
  });
}

/**
 * Reports an element's `filter`, `mask` and `clip-path`, none of which the board applies; a clip
 * that clips nothing is not reported.
 *
 * @param style - The element's computed style.
 * @param ctm - Its map.
 * @param objects - What it drew.
 * @param walk - The walk.
 */
export function reportEffects(
  style: SvgStyle,
  ctm: AffineMap,
  objects: readonly SvgImportedObject[],
  walk: Walk,
): void {
  for (const effect of style.effects) {
    if (effect === 'clip-path' && clipsNothing(style.clipPath, ctm, objects, walk)) continue;
    report(walk, { feature: effect, detail: `${effect} is not applied; drawn without it` });
  }
}
