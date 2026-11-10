import type { ConnectorObject, Point } from '@canvas/schema';
import { CONNECTOR_LABEL_WRAP_WIDTH, measureText, measuringFontsFor } from '@canvas/text';

import type { WorldBounds } from '../camera/camera.js';
import { capReach } from '../paths/caps.js';
import type { LineGap } from '../paths/line-gap.js';
import type { LineMeshShape } from '../paths/line-mesh.js';
import { isSameStrokeStyle, strokeOutlineOf, strokeOutlineReach } from '../paths/stroke-outline.js';

import { connectorShapeOf, isSameConnectorPath } from './connector-shape.js';

/**
 * The padding around a connector's label where its line breaks, world units: its glyphs'
 * ink runs about 2 past the text's advance, so 6 leaves a clear 4.
 */
export const LABEL_GAP_PADDING = 6;

/**
 * The route and caps of a connector, for its mesh: its routed path, and a curved connector's
 * cubic, and, when it has a label with text, the gap its line breaks around: the label's
 * text as laid out (`measureText` at its wrap width, with the bundled faces' metrics) and
 * {@link LABEL_GAP_PADDING} more on each side, clear of the stroke's own ends, centred where the label is.
 *
 * @param connector - A placed connector.
 * @returns Its mesh shape.
 */
export function connectorMeshShapeOf(connector: ConnectorObject): LineMeshShape {
  const { path, label } = connectorShapeOf(connector);
  const caps = { startCap: connector.startCap, endCap: connector.endCap };
  const gap = connectorLabelGapOf(connector, label);
  const shape = path.curve
    ? { route: path.route, curve: path.curve, ...caps }
    : { route: path.route, ...caps };
  return gap === undefined ? shape : { ...shape, gap };
}

/**
 * The gap a connector's line leaves around its label: none without a label or with an empty one.
 *
 * @param connector - The connector.
 * @param center - Where its label is centred, in its frame.
 * @returns The gap, or `undefined`.
 */
function connectorLabelGapOf(connector: ConnectorObject, center: Point): LineGap | undefined {
  const size = connectorLabelSize(connector);
  if (size === undefined) return undefined;
  // The stroke's ends at the gap (round, unless its strokeCap says otherwise) reach half its width
  // back in, so the clear padding is the same whatever the width.
  const reach = LABEL_GAP_PADDING + connector.stroke.width / 2;
  return { center, halfWidth: size.width / 2 + reach, halfHeight: size.height / 2 + reach };
}

/** A connector label's laid-out size ({@link connectorLabelSize}). */
export interface ConnectorLabelSize {
  /** Its widest line, world units. */
  readonly width: number;
  /** Its lines' height, world units. */
  readonly height: number;
}

/**
 * The size of a connector's label as laid out, centred on its label point (its line's gap,
 * and where a press drags it): its text at the label's wrap width, measured with the bundled
 * faces' metrics. Pure.
 *
 * @param connector - The connector.
 * @returns The width and height, world units, or `undefined` without a label or with an empty one.
 */
export function connectorLabelSize(connector: ConnectorObject): ConnectorLabelSize | undefined {
  const content = connector.label;
  if (content === null || content.text.trim() === '') return undefined;
  // A label is measured once: the document hands out the same object until it changes.
  const known = MEASURED_LABELS.get(content);
  if (known !== undefined) return known;
  const { fonts } = measuringFontsFor([content.runs]);
  const measured = measureText(content.text, content.runs, CONNECTOR_LABEL_WRAP_WIDTH, fonts);
  const size = { width: measured.width, height: measured.height };
  MEASURED_LABELS.set(content, size);
  return size;
}

/** The labels measured so far, by the label object (one measurement per label). */
const MEASURED_LABELS = new WeakMap<NonNullable<ConnectorObject['label']>, ConnectorLabelSize>();

/**
 * A box a connector's drawing stays inside, in its own frame: its route's corners (and a curve's
 * control points, whose hull holds it) grown by the farther reach of its caps, a whole stroke
 * width and its outline's reach, as a line's (`lineLocalBounds`).
 *
 * @param connector - A placed connector.
 * @returns The box.
 */
export function connectorLocalBounds(connector: ConnectorObject): WorldBounds {
  const { path } = connectorShapeOf(connector);
  const width = connector.stroke.width;
  const reach = Math.max(
    width,
    strokeOutlineReach(width, strokeOutlineOf(connector)),
    capReach(connector.startCap, width),
    capReach(connector.endCap, width),
  );
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { x, y } of [...path.route, ...(path.curve ?? [])]) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX: minX - reach, minY: minY - reach, maxX: maxX + reach, maxY: maxY + reach };
}

/**
 * Whether two connectors build the same mesh: the same path, caps, stroke width and stroke style,
 * and the same label and label position, which size and place the line's gap.
 * Colour and placement do not matter.
 *
 * @param a - One placed connector.
 * @param b - The other.
 * @returns True when their meshes are the same.
 */
export function isSameConnectorMesh(a: ConnectorObject, b: ConnectorObject): boolean {
  return (
    a.stroke.width === b.stroke.width &&
    isSameStrokeStyle(a, b) &&
    a.startCap === b.startCap &&
    a.endCap === b.endCap &&
    // The label sizes and places the line's gap.
    a.labelPosition === b.labelPosition &&
    (a.label === b.label || JSON.stringify(a.label) === JSON.stringify(b.label)) &&
    isSameConnectorPath(connectorShapeOf(a).path, connectorShapeOf(b).path)
  );
}
