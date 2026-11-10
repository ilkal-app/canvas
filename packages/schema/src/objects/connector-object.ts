import { z } from 'zod';

import { lineCapSchema } from '../fields/line-cap.js';
import { layerShape } from '../fields/opacity.js';
import { unitPointSchema } from '../fields/point.js';
import { strokeStyleFields } from '../fields/stroke-style.js';
import { strokeSchema } from '../fields/stroke.js';
import { textContentSchema } from '../fields/text-content.js';
import { visibilityShape } from '../fields/visibility.js';
import { objectIdSchema } from '../ids/object-id.js';

import { baseObjectSchema } from './base-object.js';

/** How far from the line between its ends a curved connector's bend may sit, in its lengths. */
export const MAX_CURVE_POINT_REACH = 10;

/**
 * Validates a connector's `curvePoint`: the point its curve passes through halfway,
 * relative to the line between its ends, in fractions of that line's length (`x` along it from
 * `from`, `y` across it to the right of the travel), each within {@link MAX_CURVE_POINT_REACH}.
 */
export const connectorCurvePointSchema = z.strictObject({
  /** Along the line from `from` (0) to `to` (1). */
  x: z
    .number()
    .min(-MAX_CURVE_POINT_REACH)
    .max(MAX_CURVE_POINT_REACH)
    .describe('Along the line from from (0) to to (1).'),
  /** Across the line, to the right of the travel from `from` to `to`. */
  y: z
    .number()
    .min(-MAX_CURVE_POINT_REACH)
    .max(MAX_CURVE_POINT_REACH)
    .describe('Across the line, to the right of the travel from from to to.'),
});

/** A connector's `curvePoint`. */
export type ConnectorCurvePoint = z.output<typeof connectorCurvePointSchema>;

/** How a connector is routed between its ends. */
export const CONNECTOR_ROUTES = ['straight', 'elbow', 'curved'] as const;

/**
 * Validates one end of a connector: attached to an object, or a free point.
 *
 * - `{ kind: 'object', objectId, anchor }`: attached to the object `objectId`. `anchor` is a
 *   point in the unit square of the target's bounds (`{ x: 0.5, y: 0 }` is the middle of the
 *   top edge), or `null` to let the router pick the nearest side whenever either end moves.
 * - `{ kind: 'point', x, y }`: a free point in the connector's own frame. An attached end
 *   becomes a free point where it was when its target is deleted.
 */
export const connectorEndSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    /** Attached to an object. */
    kind: z.literal('object'),
    /** The object this end is attached to. */
    objectId: objectIdSchema.describe('The object this end is attached to.'),
    /** Where on the target's bounds, as fractions of its size; null picks the nearest side. */
    anchor: unitPointSchema
      .nullable()
      .describe(
        "Where on the target's bounds, as fractions of its size; null picks the nearest side.",
      ),
  }),
  z.strictObject({
    /** A free point. */
    kind: z.literal('point'),
    /** x of the free end in the connector's own frame, world units. */
    x: z.number().describe("x of the free end in the connector's own frame, world units."),
    /** y of the free end in the connector's own frame, world units. */
    y: z.number().describe("y of the free end in the connector's own frame, world units."),
  }),
]);

/** One end of a connector: attached to an object, or a free point. */
export type ConnectorEnd = z.output<typeof connectorEndSchema>;

/**
 * Validates a connector object: a routed stroke between two ends, each
 * attached to an object or free, re-routed whenever an attached object moves. Targets must be
 * other objects that are neither connectors nor comments; `validateBoard` checks that against
 * the board.
 */
export const connectorObjectSchema = baseObjectSchema
  .extend({
    /** Always `'connector'`: the discriminator of this object type. */
    type: z.literal('connector'),
    /** The layer's opacity from 0 to 1; absent is opaque. */
    ...layerShape,
    ...visibilityShape,
    /** The start of the connector. */
    from: connectorEndSchema.describe('The start of the connector.'),
    /** The end of the connector. */
    to: connectorEndSchema.describe('The end of the connector.'),
    /** straight, elbow or curved. */
    route: z.enum(CONNECTOR_ROUTES).describe('straight, elbow or curved.'),
    /** The colour and width of the connector line. */
    stroke: strokeSchema,
    ...strokeStyleFields,
    /** The decoration at the `from` end. */
    startCap: lineCapSchema,
    /** The decoration at the `to` end. */
    endCap: lineCapSchema,
    /** Text drawn along the route (at `labelPosition`), or null for none. */
    label: textContentSchema
      .nullable()
      .describe('Text drawn along the route, at labelPosition, or null for none.'),
    /**
     * Where the label's centre sits, as a fraction of the route's length from `from` (0) to `to`
     * (1), as a person drags it along; absent is the midpoint.
     */
    labelPosition: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("The label's place along the route, 0 (from) to 1 (to); absent is 0.5."),
    /**
     * Where an elbow route's movable piece runs, as a fraction of the way from the `from` end's
     * stub (0) to the `to` end's (1), as a person drags it: its middle piece with two
     * bends, or with one bend the arm reaching the `to` end's stub, which then gains a bend.
     * Absent is the automatic route: halfway with two bends, the corner with one
     * (`elbowConnectorRoute`).
     */
    elbowMiddle: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "Elbow routes: where the movable piece (the middle one, or an L's arm into the end) runs between the ends' stubs, 0 (from) to 1 (to); absent is the automatic route.",
      ),
    /**
     * The point a curved route passes through halfway, as a person bends it: relative to
     * the line from `from` to `to`, in fractions of its length, `x` along it and `y` across it (to
     * the right of the travel), so the bend keeps its shape as the ends move; absent is the
     * automatic curve. Read only by a curved route (`curvedConnectorCubic`).
     */
    curvePoint: connectorCurvePointSchema
      .optional()
      .describe(
        'Curved routes: the point the curve passes through halfway, relative to the line between the ends in fractions of its length: x along it, y across it; absent is automatic.',
      ),
  })
  .describe('A routed stroke between two ends, each attached to an object or free.');

/** A connector object. */
export type ConnectorObject = z.output<typeof connectorObjectSchema>;
