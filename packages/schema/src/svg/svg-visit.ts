// Walking an SVG document: containers, drawables and `<use>` references, with styles
// inherited, transforms composed and every element counted against the cap. Pure.
import type { AffineMap } from '../geometry/affine-map.js';

import { reportEffects } from './svg-clip.js';
import { drawElement } from './svg-draw.js';
import { composeMaps, IDENTITY } from './svg-geometry.js';
import { SVG_IMPORT_LIMITS } from './svg-limits.js';
import { positionOf } from './svg-outline.js';
import { computeStyle, type SvgStyle } from './svg-style.js';
import { excerpt, readLength, readTransform } from './svg-values.js';
import { viewportMap } from './svg-viewport.js';
import { ImportRefusal, report, type Walk } from './svg-walk.js';
import type { SvgElement } from './svg-xml.js';

const DRAWABLES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
/** The elements that group others and are drawn through. */
const CONTAINERS = new Set(['g', 'a', 'switch', 'svg']);
/** Elements never drawn where they stand: resources, metadata. */
const NOT_DRAWN = new Set([
  'defs',
  'symbol',
  'title',
  'desc',
  'metadata',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'filter',
  'marker',
  'style',
  'script',
]);
/** Elements the board cannot draw, and what the report says of them. */
const UNSUPPORTED: Readonly<Record<string, string>> = {
  text: 'text is not imported',
  image: 'images are not imported',
  foreignObject: 'foreign content is not imported',
  video: 'video is not imported',
  audio: 'audio is not imported',
  animate: 'animation is not imported; the first frame is drawn',
  animateMotion: 'animation is not imported; the first frame is drawn',
  animateTransform: 'animation is not imported; the first frame is drawn',
  set: 'animation is not imported; the first frame is drawn',
};

/**
 * Draws an element and its descendants.
 *
 * @param element - The element.
 * @param parentStyle - Its parent's computed style.
 * @param parentCtm - From its parent's user space to the group's frame.
 * @param parentOpacity - Its ancestors' opacity.
 * @param walk - The walk.
 * @throws {ImportRefusal} Past the cap on visited elements, nesting depth, objects or vertices.
 */
export function visit(
  element: SvgElement,
  parentStyle: SvgStyle,
  parentCtm: AffineMap,
  parentOpacity: number,
  walk: Walk,
): void {
  walk.visited += 1;
  if (walk.visited > SVG_IMPORT_LIMITS.maxVisitedElements) {
    throw new ImportRefusal(
      `the SVG expands to more than ${String(SVG_IMPORT_LIMITS.maxVisitedElements)} elements`,
    );
  }
  if (walk.depth >= SVG_IMPORT_LIMITS.maxDrawDepth) {
    throw new ImportRefusal(
      `elements nest deeper than ${String(SVG_IMPORT_LIMITS.maxDrawDepth)}, <use> references included`,
    );
  }
  walk.depth += 1;
  visitElement(element, parentStyle, parentCtm, parentOpacity, walk);
  walk.depth -= 1;
}

/**
 * Draws one element and its descendants, once `visit` has counted it.
 *
 * @param element - The element.
 * @param parentStyle - Its parent's computed style.
 * @param parentCtm - From its parent's user space to the group's frame.
 * @param parentOpacity - Its ancestors' opacity.
 * @param walk - The walk.
 */
function visitElement(
  element: SvgElement,
  parentStyle: SvgStyle,
  parentCtm: AffineMap,
  parentOpacity: number,
  walk: Walk,
): void {
  const { name } = element;
  if (NOT_DRAWN.has(name)) return;
  const unsupported = UNSUPPORTED[name];
  if (unsupported !== undefined) {
    report(walk, { feature: name, detail: unsupported });
    return;
  }
  if (!CONTAINERS.has(name) && !DRAWABLES.has(name) && name !== 'use') {
    report(walk, {
      feature: `<${excerpt(name)}>`,
      detail: 'not an element the import draws; skipped',
    });
    return;
  }
  const style = computeStyle(element, parentStyle);
  if (style.display === 'none') return;
  const transformValue = element.attributes.get('transform');
  let own = transformValue === undefined ? IDENTITY : readTransform(transformValue);
  if (own === undefined) {
    report(walk, {
      feature: 'transform',
      detail: `"${excerpt(String(transformValue))}" is unreadable; ignored`,
    });
    own = IDENTITY;
  }
  const ctm = composeMaps(parentCtm, own);
  const opacity = parentOpacity * style.opacity;
  const before = walk.objects.length;
  if (DRAWABLES.has(name)) {
    drawElement(element, style, ctm, opacity, walk);
    // A drawable's children are animations and metadata: report the animations.
    for (const child of element.children) {
      const issue = UNSUPPORTED[child.name];
      if (issue !== undefined) report(walk, { feature: child.name, detail: issue });
    }
  } else if (name === 'use') visitUse(element, style, ctm, opacity, walk);
  else drawChildren(element, style, ctm, opacity, walk);
  reportEffects(style, ctm, walk.objects.slice(before), walk);
}

/**
 * Draws a container's children: a `<g>`, `<a>`, `<switch>` (every child) or nested `<svg>` (a
 * viewport of its own).
 *
 * @param element - The container.
 * @param style - Its computed style.
 * @param ctm - Its map, its own transform included.
 * @param opacity - Its opacity and its ancestors'.
 * @param walk - The walk.
 */
function drawChildren(
  element: SvgElement,
  style: SvgStyle,
  ctm: AffineMap,
  opacity: number,
  walk: Walk,
): void {
  let childCtm = ctm;
  if (element.name === 'switch') {
    report(walk, { feature: 'switch', detail: 'every child of <switch> is drawn' });
  }
  if (element.name === 'svg') {
    const { x, y } = positionOf(element, walk);
    const width = readLength(element.attributes.get('width'));
    const height = readLength(element.attributes.get('height'));
    const size = width === undefined || height === undefined ? undefined : { width, height };
    childCtm = composeMaps(ctm, viewportMap(element, x, y, size, walk));
  }
  const before = walk.objects.length;
  for (const child of element.children) visit(child, style, childCtm, opacity, walk);
  if (style.opacity < 1 && walk.objects.length - before > 1) {
    report(walk, {
      feature: 'opacity',
      detail: "a group's opacity is applied to each object in it separately",
    });
  }
}

/**
 * Draws what a `<use>` references: an element of this document by `#id`, moved by the use's
 * `x` and `y`; a `<symbol>` or `<svg>` as a viewport sized by the use. External references are
 * never fetched, and a reference cycle is cut.
 *
 * @param use - The `<use>` element.
 * @param style - Its computed style, which the referenced content inherits.
 * @param ctm - Its map, its own transform included.
 * @param opacity - Its opacity and its ancestors'.
 * @param walk - The walk.
 */
function visitUse(
  use: SvgElement,
  style: SvgStyle,
  ctm: AffineMap,
  opacity: number,
  walk: Walk,
): void {
  const href = (use.attributes.get('href') ?? use.attributes.get('xlink:href'))?.trim();
  // A <use> without a reference draws nothing.
  if (href === undefined) return;
  if (!href.startsWith('#')) {
    report(walk, {
      feature: 'external reference',
      detail: `<use> of "${excerpt(href)}" is never fetched; not drawn`,
    });
    return;
  }
  const id = href.slice(1);
  const target = walk.ids.get(id);
  if (target === undefined) {
    report(walk, { feature: 'use', detail: `${excerpt(href)} is not in the document; not drawn` });
    return;
  }
  if (walk.using.includes(id)) {
    report(walk, {
      feature: 'use',
      detail: `${excerpt(href)} references itself; the cycle is cut`,
    });
    return;
  }
  const { x, y } = positionOf(use, walk);
  walk.using.push(id);
  if (target.name === 'symbol' || target.name === 'svg') {
    const width = readLength(use.attributes.get('width') ?? target.attributes.get('width'));
    const height = readLength(use.attributes.get('height') ?? target.attributes.get('height'));
    const size = width === undefined || height === undefined ? undefined : { width, height };
    const symbolStyle = computeStyle(target, style);
    const symbolCtm = composeMaps(ctm, viewportMap(target, x, y, size, walk));
    for (const child of target.children)
      visit(child, symbolStyle, symbolCtm, opacity * symbolStyle.opacity, walk);
  } else {
    visit(target, style, composeMaps(ctm, { ...IDENTITY, x, y }), opacity, walk);
  }
  walk.using.pop();
}
