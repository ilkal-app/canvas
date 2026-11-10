import {
  findFreehandIssues,
  freehandPointsOf,
  capReason,
  colorReason,
  coordinateReason,
  cropReason,
  fittedImageRect,
  INK,
  instanceScaleReason,
  MAX_DRAWABLE_SIZE,
  MAX_STROKE_WIDTH,
  naturalSizeReason,
  pointReason,
  scalarReason,
  SHAPE_KINDS,
  sidesReason,
  sizeReason,
  textRunsReason,
  unitReason,
  type BoardObject,
  type ConnectorEnd,
  type ImageObject,
  type StyleRun,
  type UndrawableReason,
} from '@canvas/schema';

import { BASE_COLOR } from '../paint/paint-reading.js';

import { drawnCopyRuns, drawnCopyScaleReason, isDrawnCopy } from './drawn-copy-ranges.js';

/** The shape kinds the SDF shape pass has a code for. */
const KINDS: ReadonlySet<string> = new Set(SHAPE_KINDS);

/**
 * Judges a fill or a frame's background: a tuple's
 * channels as before; a gradient, or anything else that is not a tuple, never makes the object
 * undrawable, since the passes draw a gradient the schema refuses as no fill (`readFill`).
 *
 * @param fill - The stored fill.
 * @returns The reason, or undefined.
 */
function fillReason(fill: unknown): UndrawableReason | undefined {
  return Array.isArray(fill) ? colorReason(fill as readonly number[]) : undefined;
}

/**
 * Judges a stroke or text colour: a tuple's channels as before; `'ink'` and any other value that
 * is not a tuple are drawable (an unreadable one draws in the base colour, `readInkable`).
 *
 * @param color - The stored colour.
 * @returns The reason, or undefined.
 */
function inkableReason(color: unknown): UndrawableReason | undefined {
  return Array.isArray(color) ? colorReason(color as readonly number[]) : undefined;
}

/**
 * Judges a stroke: its colour (`inkableReason`) and its width from 0 to the schema's
 * `MAX_STROKE_WIDTH`, as the schema's `strokeReason` does; a scaled instance's copy
 * may draw it wider, up to `MAX_DRAWABLE_SIZE`.
 *
 * @param stroke - The stroke, or null.
 * @param isCopy - Whether it is a virtual copy's, judged by drawn ranges (`isDrawnCopy`).
 * @returns The reason, or undefined.
 */
function strokeReason(
  stroke: { readonly color: unknown; readonly width: number } | null,
  isCopy: boolean,
): UndrawableReason | undefined {
  if (stroke === null) return undefined;
  const reason = inkableReason(stroke.color) ?? sizeReason(stroke.width);
  if (reason !== undefined || isCopy) return reason;
  return stroke.width > MAX_STROKE_WIDTH ? 'out-of-range' : undefined;
}

/**
 * Judges a text's runs as the schema's `textRunsReason` does, except that a run colour that is
 * neither a tuple nor `'ink'` is read as the base colour rather than refused. A scaled instance's
 * copy has its font sizes and px spacing judged by drawn ranges (`drawnCopyRuns`).
 *
 * @param source - The text, or null for none.
 * @param isCopy - Whether it is a virtual copy's, judged by drawn ranges (`isDrawnCopy`).
 * @returns The reason, or undefined.
 */
function runsReason(
  source: { readonly text: string; readonly runs: readonly StyleRun[] } | null,
  isCopy: boolean,
): UndrawableReason | undefined {
  if (source === null) return textRunsReason(source);
  const drawn = isCopy ? drawnCopyRuns(source.runs) : { runs: source.runs };
  if ('reason' in drawn) return drawn.reason;
  const content = { text: source.text, runs: drawn.runs };
  const isReadable = content.runs.every(
    ({ style }) => style.color === INK || Array.isArray(style.color),
  );
  if (isReadable) return textRunsReason(content);
  const runs = content.runs.map((run) =>
    run.style.color === INK || Array.isArray(run.style.color)
      ? run
      : { ...run, style: { ...run.style, color: BASE_COLOR } },
  );
  return textRunsReason({ text: content.text, runs });
}

/**
 * Judges a connector's end: a free point, or an anchor on its target (a fraction of its box).
 *
 * @param end - The end.
 * @returns The reason, or undefined.
 */
function connectorEnd(end: ConnectorEnd): UndrawableReason | undefined {
  if (end.kind === 'point') return scalarReason(end.x) ?? scalarReason(end.y);
  return end.anchor === null ? undefined : (unitReason(end.anchor.x) ?? unitReason(end.anchor.y));
}

/**
 * Judges an image's fields: its crop in the unit square, its natural size, its opacity, and the
 * whole image behind the crop (the drawn box divided by the crop's size, the image record's
 * scale), which must lie within `MAX_DRAWABLE_SIZE` as the command layer's value limit requires:
 * a crop of 1e-310 in a 100-unit box makes that scale infinite and writes NaN into the
 * image record (0 × Infinity).
 *
 * @param image - The image.
 * @returns The reason, or undefined.
 */
function imageReason(image: ImageObject): UndrawableReason | undefined {
  const { crop } = image;
  const reason =
    cropReason(crop) ??
    naturalSizeReason(image.naturalSize.width) ??
    naturalSizeReason(image.naturalSize.height) ??
    unitReason(image.opacity);
  if (reason !== undefined) return reason;
  const drawn = fittedImageRect(image);
  const isWithin =
    drawn.width / crop.width <= MAX_DRAWABLE_SIZE &&
    drawn.height / crop.height <= MAX_DRAWABLE_SIZE;
  return isWithin ? undefined : 'past-extent';
}

/**
 * Judges the fields one type of object adds to the shared ones.
 *
 * @param object - The object.
 * @returns The reason, or undefined.
 */
function typeFieldsReason(object: BoardObject): UndrawableReason | undefined {
  const isCopy = isDrawnCopy(object);
  switch (object.type) {
    case 'shape':
      return (
        (KINDS.has(object.kind) ? undefined : 'out-of-range') ??
        strokeReason(object.stroke, isCopy) ??
        fillReason(object.fill) ??
        sizeReason(object.cornerRadius) ??
        sidesReason(object.sides) ??
        runsReason(object.label, isCopy)
      );
    case 'sticky':
      return colorReason(object.color) ?? runsReason(object, isCopy);
    case 'text':
      return runsReason(object, isCopy);
    case 'image':
      return imageReason(object);
    case 'video':
      return object.trim === null
        ? undefined
        : (scalarReason(object.trim.startMs) ?? scalarReason(object.trim.endMs));
    case 'frame':
      return fillReason(object.background);
    case 'instance':
      if (object.scale === undefined) return undefined;
      return isCopy ? drawnCopyScaleReason(object.scale) : instanceScaleReason(object.scale);
    default:
      return strokedFieldsReason(object);
  }
}

/**
 * Judges the fields of the objects drawn as strokes and of those with no geometry of their own.
 *
 * @param object - A line, path, freehand stroke, connector, comment or group.
 * @returns The reason, or undefined.
 */
function strokedFieldsReason(object: BoardObject): UndrawableReason | undefined {
  const isCopy = isDrawnCopy(object);
  switch (object.type) {
    case 'line': {
      const [start, end] = object.points;
      return (
        coordinates(start) ??
        coordinates(end) ??
        strokeReason(object.stroke, isCopy) ??
        capReason(object.startCap) ??
        capReason(object.endCap)
      );
    }
    case 'path': {
      for (const vertex of object.vertices) {
        if (coordinates(vertex) !== undefined) return 'not-finite';
      }
      for (const { ha, hb } of object.segments) {
        if (coordinates(ha) !== undefined || coordinates(hb) !== undefined) return 'not-finite';
      }
      return strokeReason(object.stroke, isCopy) ?? fillReason(object.fill);
    }
    case 'freehand': {
      // Its loops run over honest counts: an even count of numbers, one pressure per point.
      if (findFreehandIssues(object.points, object.pressures).length > 0) return 'out-of-range';
      for (const point of freehandPointsOf(object.points)) {
        if (coordinates(point) !== undefined) return 'not-finite';
      }
      for (const pressure of object.pressures ?? []) {
        const reason = unitReason(pressure);
        if (reason !== undefined) return reason;
      }
      return strokeReason(object.stroke, isCopy);
    }
    case 'connector':
      return (
        connectorEnd(object.from) ??
        connectorEnd(object.to) ??
        strokeReason(object.stroke, isCopy) ??
        capReason(object.startCap) ??
        capReason(object.endCap) ??
        runsReason(object.label, isCopy)
      );
    case 'comment':
      return object.anchor.kind === 'object' ? pointReason(object.anchor.offset) : undefined;
    default:
      return undefined;
  }
}

/**
 * Judges a point whose magnitude the extent check bounds afterwards: finite only.
 *
 * @param at - The point.
 * @param at.x - Its x.
 * @param at.y - Its y.
 * @returns The reason, or undefined.
 */
function coordinates(at: { readonly x: number; readonly y: number }): UndrawableReason | undefined {
  return coordinateReason(at.x) ?? coordinateReason(at.y);
}

/**
 * Judges an object's own fields, without its parent or its place on the board, so that
 * everything the engine writes to a float32 GPU buffer is finite there and nothing it loops over
 * runs past an honest count: every number it reads is finite; colours, opacity and a crop's
 * corner lie in [0, 1], a crop's size in (0, 1] and the crop within the image; `sides` is an integer from 3 to 64 and the
 * kind and caps are ones the schema lists; a stroke is at most 64 wide; run lengths are whole
 * and cover the text (at least one run); a width, height or corner radius lies in
 * [0, `MAX_DRAWABLE_SIZE`], a natural size is a whole number in [1, `MAX_DRAWABLE_SIZE`] and a
 * font size in the schema's 4 to 400; any other number (a rotation, a weight, a free end)
 * within float32's range. A scaled instance's virtual copy holds its stroke widths, font
 * sizes and px text spacing to drawn ranges instead (`drawn-copy-ranges.ts`): finite and within
 * `MAX_DRAWABLE_SIZE`. Coordinates are held to the extent by `undrawableReasonOf`. Timestamps
 * and ids are not read. Pure; O(the object's points and runs), no allocation.
 *
 * @param object - The object; not mutated.
 * @returns The reason it cannot be drawn, or undefined when its own fields are drawable.
 */
export function ownUndrawableReason(object: BoardObject): UndrawableReason | undefined {
  return coordinateReason(object.x) ?? coordinateReason(object.y) ?? fixedFieldsReason(object);
}

/**
 * Judges fields unchanged by an engine-proven root x/y move, in ordinary reason order.
 *
 * @param object - The object whose non-position fields are unchanged.
 * @returns The first invariant field failure, or undefined.
 */
export function fixedFieldsReason(object: BoardObject): UndrawableReason | undefined {
  const rotation = scalarReason(object.rotation);
  if (rotation !== undefined) return rotation;
  if ('width' in object) {
    const box = sizeReason(object.width) ?? sizeReason(object.height);
    if (box !== undefined) return box;
  }
  return typeFieldsReason(object);
}
