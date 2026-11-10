// Viewports (SVG 2 §8.2): the root `<svg>` fitted to the size asked on the board, and
// nested `<svg>` and `<symbol>` viewports, each `viewBox` fitted by `preserveAspectRatio`. The
// board does not clip, so a `slice` is reported. Pure.
import type { AffineMap } from '../geometry/affine-map.js';

import { composeMaps, IDENTITY } from './svg-geometry.js';
import { excerpt, readLength, readNumberList } from './svg-values.js';
import { report, type Walk } from './svg-walk.js';
import type { SvgElement } from './svg-xml.js';

/**
 * The map a `viewBox` and `preserveAspectRatio` give from a viewport's user space into a box of
 * the given size at the origin (SVG 2 §8.2).
 *
 * @param viewBox - `[x, y, width, height]`, the sizes above 0.
 * @param ratio - The `preserveAspectRatio` attribute, or undefined.
 * @param width - The viewport's width.
 * @param height - The viewport's height.
 * @param walk - Where a `slice` is reported (the board does not clip).
 * @returns The map.
 */
export function viewBoxMap(
  viewBox: readonly [number, number, number, number],
  ratio: string | undefined,
  width: number,
  height: number,
  walk: Walk,
): AffineMap {
  const [x, y, boxWidth, boxHeight] = viewBox;
  const words = (ratio ?? '')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== 'defer');
  const align = words[0] ?? 'xMidYMid';
  let sx = width / boxWidth;
  let sy = height / boxHeight;
  let tx = -x * sx;
  let ty = -y * sy;
  if (align !== 'none') {
    const isSlice = words[1] === 'slice';
    if (isSlice)
      report(walk, { feature: 'clipping', detail: 'preserveAspectRatio "slice" is not clipped' });
    const scale = isSlice ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = scale;
    sy = scale;
    const spareX = width - boxWidth * scale;
    const spareY = height - boxHeight * scale;
    const share = (part: string): number => (part === 'Mid' ? 0.5 : part === 'Max' ? 1 : 0);
    const match = /^x(Min|Mid|Max)Y(Min|Mid|Max)$/.exec(align);
    tx = -x * scale + spareX * share(match?.[1] ?? 'Mid');
    ty = -y * scale + spareY * share(match?.[2] ?? 'Mid');
  }
  return { a: sx, b: 0, c: 0, d: sy, x: tx, y: ty };
}

/**
 * Reads a `viewBox`: four numbers, the sizes above 0.
 *
 * @param element - The element.
 * @param walk - Where an unreadable one is reported.
 * @returns The view box, or undefined when absent or unreadable.
 */
export function viewBoxOf(
  element: SvgElement,
  walk: Walk,
): readonly [number, number, number, number] | undefined {
  const value = element.attributes.get('viewBox');
  if (value === undefined) return undefined;
  const numbers = readNumberList(value);
  const [x = 0, y = 0, width = 0, height = 0] = numbers ?? [];
  if (numbers?.length !== 4 || !(width > 0) || !(height > 0)) {
    report(walk, { feature: 'viewBox', detail: `"${excerpt(value)}" is unreadable; ignored` });
    return undefined;
  }
  return [x, y, width, height];
}

/**
 * The map from a nested viewport's (`<svg>`, or `<symbol>` through `<use>`) user space to its
 * parent's: its position, and its `viewBox` fitted to its size.
 *
 * @param element - The `svg` or `symbol`.
 * @param x - Its x in the parent.
 * @param y - Its y in the parent.
 * @param size - Its width and height, or undefined when unknown (no scaling then).
 * @param walk - The walk.
 * @returns The map.
 */
export function viewportMap(
  element: SvgElement,
  x: number,
  y: number,
  size: { width: number; height: number } | undefined,
  walk: Walk,
): AffineMap {
  const viewBox = viewBoxOf(element, walk);
  const place = { ...IDENTITY, x, y };
  if (viewBox === undefined || size === undefined) return place;
  const fit = viewBoxMap(
    viewBox,
    element.attributes.get('preserveAspectRatio'),
    size.width,
    size.height,
    walk,
  );
  return composeMaps(place, fit);
}

/**
 * The size of the root viewport on the board, and the map from its user space into a box of that
 * size at the origin. Given one of width and height, the other follows the SVG's aspect ratio;
 * given neither, the SVG's own `width` and `height`, else its `viewBox`'s.
 *
 * @param root - The `<svg>`.
 * @param options - The requested size.
 * @param options.width - The width asked, world units.
 * @param options.height - The height asked, world units.
 * @param walk - The walk.
 * @returns The size and the map.
 */
export function rootViewport(
  root: SvgElement,
  options: { readonly width?: number; readonly height?: number },
  walk: Walk,
): { width: number; height: number; map: AffineMap } {
  const viewBox = viewBoxOf(root, walk);
  const ownWidth = readLength(root.attributes.get('width'));
  const ownHeight = readLength(root.attributes.get('height'));
  const intrinsicWidth = ownWidth ?? viewBox?.[2];
  const intrinsicHeight = ownHeight ?? viewBox?.[3];
  const aspect =
    viewBox === undefined
      ? intrinsicWidth !== undefined && intrinsicHeight !== undefined && intrinsicHeight > 0
        ? intrinsicWidth / intrinsicHeight
        : 1
      : viewBox[2] / viewBox[3];
  const width =
    options.width ??
    (options.height === undefined ? (intrinsicWidth ?? 300) : options.height * aspect);
  const height =
    options.height ??
    (options.width === undefined ? (intrinsicHeight ?? 150) : options.width / aspect);
  // Without a viewBox, the SVG's own size (if any) stands in for one, so the import still scales.
  const box: readonly [number, number, number, number] | undefined =
    viewBox ??
    (ownWidth !== undefined && ownHeight !== undefined && ownWidth > 0 && ownHeight > 0
      ? [0, 0, ownWidth, ownHeight]
      : undefined);
  if (box === undefined) return { width, height, map: IDENTITY };
  const map = viewBoxMap(box, root.attributes.get('preserveAspectRatio'), width, height, walk);
  return { width, height, map };
}
