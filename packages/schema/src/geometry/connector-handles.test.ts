import { describe, expect, it } from 'vitest';

import { drawableValuesReason } from '../drawable/drawable-values.js';
import {
  curvePointValueReason,
  labelPositionValueReason,
} from '../drawable/label-position-values.js';
import type { Point } from '../fields/point.js';
import { MIGRATIONS } from '../migrations/migration-registry.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import { connectorObjectSchema } from '../objects/connector-object.js';
import { CONNECTOR_HANDLES_VERSION, SCHEMA_VERSION } from '../version/schema-version.js';

import { evalCubic } from './bezier.js';
import type { PlacedConnectorEnd } from './connector-ends.js';
import {
  connectorPathOf,
  cubicMidpoint,
  curvedConnectorCubic,
  curvePointOf,
  curvePointPosition,
  ELBOW_STUB,
  elbowConnectorRoute,
  elbowMiddlePiece,
} from './connector-path.js';
import { connectorShapeFrom } from './connector-shape.js';

const RIGHT = { x: 1, y: 0 };
const LEFT = { x: -1, y: 0 };
const DOWN = { x: 0, y: 1 };

function end(point: Point, normal: Point | null): PlacedConnectorEnd {
  return { point, normal };
}

/** A's right side at (100, 50) to B's left side at (400, 250): a Z through a middle piece. */
const FROM = end({ x: 100, y: 50 }, RIGHT);
const TO = end({ x: 400, y: 250 }, LEFT);
const A_X = 100 + ELBOW_STUB;
const B_X = 400 - ELBOW_STUB;

describe('an elbow connector’s middle piece', () => {
  it('runs halfway between the stubs by default, as before', () => {
    const middle = (A_X + B_X) / 2;
    expect(elbowConnectorRoute(FROM, TO)).toEqual([
      { x: 100, y: 50 },
      { x: middle, y: 50 },
      { x: middle, y: 250 },
      { x: 400, y: 250 },
    ]);
  });

  it('runs the given fraction of the way from the first stub to the second', () => {
    const at = A_X + (B_X - A_X) * 0.25;
    expect(elbowConnectorRoute(FROM, TO, 0.25)).toEqual([
      { x: 100, y: 50 },
      { x: at, y: 50 },
      { x: at, y: 250 },
      { x: 400, y: 250 },
    ]);
  });

  it('is clamped to the stubs, so it never doubles back over an end', () => {
    expect(elbowConnectorRoute(FROM, TO, -1)).toEqual(elbowConnectorRoute(FROM, TO, 0));
    expect(elbowConnectorRoute(FROM, TO, 2)).toEqual(elbowConnectorRoute(FROM, TO, 1));
    // At 0 the piece meets the first stub: the stub and the first leg are one piece.
    expect(elbowConnectorRoute(FROM, TO, 0)).toEqual([
      { x: 100, y: 50 },
      { x: A_X, y: 50 },
      { x: A_X, y: 250 },
      { x: 400, y: 250 },
    ]);
  });

  it('keeps its fraction when an end moves', () => {
    const moved = end({ x: 600, y: 450 }, LEFT);
    const at = A_X + (600 - ELBOW_STUB - A_X) * 0.25;
    expect(elbowConnectorRoute(FROM, moved, 0.25)[1]).toEqual({ x: at, y: 50 });
  });

  it('names the piece’s axis and its coordinates at either stub', () => {
    expect(elbowMiddlePiece(FROM, TO)).toEqual({
      axis: 'x',
      start: A_X,
      end: B_X,
      across: [50, 250],
      automatic: 0.5,
    });
    // Two ends leaving downward: a level piece moving up and down.
    const top = end({ x: 0, y: 0 }, DOWN);
    const lower = end({ x: 300, y: 200 }, { x: 0, y: -1 });
    expect(elbowMiddlePiece(top, lower)).toEqual({
      axis: 'y',
      start: ELBOW_STUB,
      end: 200 - ELBOW_STUB,
      across: [0, 300],
      automatic: 0.5,
    });
  });

  it('moves an L’s arm into the end, at its corner by default, adding a bend (staging)', () => {
    // From the right side (stub to x 124) to the top of a box below (stub to y 226): one bend,
    // at (400, 50); the arm from it down to the end's stub is upright, so it moves along x.
    const below = end({ x: 400, y: 250 }, { x: 0, y: -1 });
    expect(elbowMiddlePiece(FROM, below)).toEqual({
      axis: 'x',
      start: A_X,
      end: 400,
      across: [50, 226],
      automatic: 1,
    });
    expect(elbowConnectorRoute(FROM, below)).toEqual([
      { x: 100, y: 50 },
      { x: 400, y: 50 },
      { x: 400, y: 250 },
    ]);
    expect(elbowConnectorRoute(FROM, below, 1)).toEqual(elbowConnectorRoute(FROM, below));
    const at = A_X + (400 - A_X) * 0.5;
    expect(elbowConnectorRoute(FROM, below, 0.5)).toEqual([
      { x: 100, y: 50 },
      { x: at, y: 50 },
      { x: at, y: 226 },
      { x: 400, y: 226 },
      { x: 400, y: 250 },
    ]);
  });

  it('moves the arm into a free end too: a centre anchor up, then across and down', () => {
    // A centre anchor leaves upward (to y −24); the end is a free point below right, so the route
    // turns at (300, −24) and comes down to it: that upright arm moves along x.
    const centre = end({ x: 0, y: 0 }, { x: 0, y: -1 });
    const free = end({ x: 300, y: 100 }, null);
    expect(elbowMiddlePiece(centre, free)).toEqual({
      axis: 'x',
      start: 0,
      end: 300,
      across: [-ELBOW_STUB, 100],
      automatic: 1,
    });
    expect(elbowConnectorRoute(centre, free)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: -ELBOW_STUB },
      { x: 300, y: -ELBOW_STUB },
      { x: 300, y: 100 },
    ]);
  });

  it('moves the fallback corner’s arm too', () => {
    // The centre-anchor L above, its arm halfway: down at x 150, then level into the free end.
    const centre = end({ x: 0, y: 0 }, { x: 0, y: -1 });
    const free = end({ x: 300, y: 100 }, null);
    expect(elbowConnectorRoute(centre, free, 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: -ELBOW_STUB },
      { x: 150, y: -ELBOW_STUB },
      { x: 150, y: 100 },
      { x: 300, y: 100 },
    ]);
  });

  it('moves a level arm along y when the L starts upright', () => {
    // Down from a bottom side (stub to y 24) to a left side at (300, 200) (stub to x 276): one
    // bend at (0, 200); the level arm into the end's stub moves along y.
    const top = end({ x: 0, y: 0 }, DOWN);
    const side = end({ x: 300, y: 200 }, LEFT);
    expect(elbowMiddlePiece(top, side)).toEqual({
      axis: 'y',
      start: ELBOW_STUB,
      end: 200,
      across: [0, 300 - ELBOW_STUB],
      automatic: 1,
    });
    expect(elbowConnectorRoute(top, side)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 200 },
      { x: 300, y: 200 },
    ]);
    const at = ELBOW_STUB + (200 - ELBOW_STUB) * 0.5;
    expect(elbowConnectorRoute(top, side, 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: at },
      { x: 300 - ELBOW_STUB, y: at },
      { x: 300 - ELBOW_STUB, y: 200 },
      { x: 300, y: 200 },
    ]);
  });

  it('has none when the stubs are level on its axis, or the piece has no length', () => {
    const level = end({ x: 100 + 2 * ELBOW_STUB, y: 250 }, LEFT);
    expect(elbowMiddlePiece(FROM, level)).toBeUndefined();
    expect(elbowMiddlePiece(FROM, end({ x: 400, y: 50 }, LEFT))).toBeUndefined();
  });

  it('never changes which way the route goes as the piece moves', () => {
    // Ends facing the same way: the piece runs across them, whatever the fraction.
    const both = end({ x: 400, y: 250 }, RIGHT);
    const piece = elbowMiddlePiece(FROM, both);
    expect(piece?.axis).toBe('y');
    for (const middle of [0.3, 0.7]) {
      const at = 50 + 200 * middle;
      expect(elbowConnectorRoute(FROM, both, middle)).toEqual([
        { x: 100, y: 50 },
        { x: A_X, y: 50 },
        { x: A_X, y: at },
        { x: 400 + ELBOW_STUB, y: at },
        { x: 400 + ELBOW_STUB, y: 250 },
        { x: 400, y: 250 },
      ]);
    }
  });
});

describe('a curved connector’s bend', () => {
  const from = end({ x: 0, y: 0 }, null);
  const to = end({ x: 200, y: 0 }, null);

  it('places a curve point along and across the line between the ends', () => {
    expect(curvePointPosition({ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0.5, y: 0.25 })).toEqual({
      x: 100,
      y: 50,
    });
    // Turned with the line: travelling down, the right of the travel is −x.
    expect(curvePointPosition({ x: 0, y: 0 }, { x: 0, y: 200 }, { x: 0.5, y: 0.25 })).toEqual({
      x: -50,
      y: 100,
    });
  });

  it('reads a position back as the same curve point', () => {
    const a = { x: 30, y: -40 };
    const b = { x: 250, y: 90 };
    const point = { x: 0.3, y: -0.7 };
    const back = curvePointOf(a, b, curvePointPosition(a, b, point));
    expect(back?.x).toBeCloseTo(point.x, 12);
    expect(back?.y).toBeCloseTo(point.y, 12);
    expect(curvePointOf(a, a, b)).toBeUndefined();
  });

  it('passes through its curve point halfway', () => {
    const cubic = curvedConnectorCubic(from, to, { x: 0.5, y: 0.25 });
    expect(evalCubic(cubic, 0.5).x).toBeCloseTo(100, 9);
    expect(evalCubic(cubic, 0.5).y).toBeCloseTo(50, 9);
    expect(cubicMidpoint(cubic).y).toBeCloseTo(50, 9);
    expect(cubic[0]).toEqual(from.point);
    expect(cubic[3]).toEqual(to.point);
  });

  it('passes through it from attached ends too, its handles shifted together', () => {
    const left = end({ x: 0, y: 0 }, DOWN);
    const right = end({ x: 300, y: 0 }, DOWN);
    const automatic = curvedConnectorCubic(left, right);
    const bent = curvedConnectorCubic(left, right, { x: 0.25, y: -0.5 });
    const target = curvePointPosition(left.point, right.point, { x: 0.25, y: -0.5 });
    expect(cubicMidpoint(bent).x).toBeCloseTo(target.x, 9);
    expect(cubicMidpoint(bent).y).toBeCloseTo(target.y, 9);
    const shift = { x: bent[1].x - automatic[1].x, y: bent[1].y - automatic[1].y };
    expect(bent[2].x - automatic[2].x).toBeCloseTo(shift.x, 9);
    expect(bent[2].y - automatic[2].y).toBeCloseTo(shift.y, 9);
  });

  it('keeps its shape as an end moves: the point scales and turns with the line', () => {
    const point = { x: 0.5, y: 0.25 };
    const far = end({ x: 0, y: 400 }, null);
    const midpoint = cubicMidpoint(curvedConnectorCubic(from, far, point));
    expect(midpoint.x).toBeCloseTo(-100, 9);
    expect(midpoint.y).toBeCloseTo(200, 9);
  });

  it('is automatic without a point, or when the ends coincide', () => {
    expect(curvedConnectorCubic(from, to, undefined)).toEqual(curvedConnectorCubic(from, to));
    expect(curvedConnectorCubic(from, from, { x: 0.5, y: 3 })).toEqual(
      curvedConnectorCubic(from, from),
    );
  });
});

describe('a connector’s path reads its route’s handle only', () => {
  it('routes an elbow by elbowMiddle and a curve by curvePoint', () => {
    const handles = { elbowMiddle: 0.25, curvePoint: { x: 0.5, y: 0.5 } };
    expect(connectorPathOf(FROM, TO, 'elbow', handles).route).toEqual(
      elbowConnectorRoute(FROM, TO, 0.25),
    );
    expect(connectorPathOf(FROM, TO, 'curved', handles).curve).toEqual(
      curvedConnectorCubic(FROM, TO, handles.curvePoint),
    );
    expect(connectorPathOf(FROM, TO, 'straight', handles).route).toEqual([FROM.point, TO.point]);
  });

  it('draws the shape from the connector’s own fields', () => {
    const shape = connectorShapeFrom({ route: 'elbow', elbowMiddle: 0 }, FROM, TO);
    expect(shape.path.route[1]).toEqual({ x: A_X, y: 50 });
  });
});

describe('the stored fields', () => {
  const connector = sampleObject('connector', 'bent');

  it('are optional, and every version 36 connector stays valid through an identity step', () => {
    expect(connectorObjectSchema.parse(connector)).not.toHaveProperty('elbowMiddle');
    expect(connectorObjectSchema.parse(connector)).not.toHaveProperty('curvePoint');
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(CONNECTOR_HANDLES_VERSION);
    const step = MIGRATIONS.get(CONNECTOR_HANDLES_VERSION);
    const document = { schemaVersion: CONNECTOR_HANDLES_VERSION - 1 } as never;
    expect(step?.(document)).toBe(document);
  });

  it('take a fraction from 0 to 1 and a point within the reach', () => {
    const valid = { ...connector, elbowMiddle: 0.3, curvePoint: { x: 0.5, y: -2 } };
    expect(connectorObjectSchema.safeParse(valid).success).toBe(true);
    for (const elbowMiddle of [-0.1, 1.1, Number.NaN]) {
      expect(connectorObjectSchema.safeParse({ ...connector, elbowMiddle }).success).toBe(false);
    }
    for (const curvePoint of [{ x: 11, y: 0 }, { x: 0 }, { x: 0, y: 0, z: 1 }]) {
      expect(connectorObjectSchema.safeParse({ ...connector, curvePoint }).success).toBe(false);
    }
  });

  it('are judged at the relay’s door as the schema judges them', () => {
    expect(labelPositionValueReason(undefined)).toBeUndefined();
    expect(labelPositionValueReason(0.5)).toBeUndefined();
    expect(labelPositionValueReason(1.5)).toEqual({ field: '', reason: 'out-of-range' });
    expect(curvePointValueReason(undefined)).toBeUndefined();
    expect(curvePointValueReason({ x: 0.5, y: -10 })).toBeUndefined();
    expect(curvePointValueReason([0, 1])).toEqual({ field: '', reason: 'not-a-record' });
    expect(curvePointValueReason(null)).toEqual({ field: '', reason: 'not-a-record' });
    expect(curvePointValueReason({ x: 0, y: 0, z: 0 })).toEqual({
      field: '',
      reason: 'not-a-record',
    });
    expect(curvePointValueReason({ x: '1', y: 0 })).toEqual({ field: 'x', reason: 'not-a-number' });
    expect(curvePointValueReason({ x: 0, y: Number.NaN })).toEqual({
      field: 'y',
      reason: 'out-of-range',
    });
    expect(drawableValuesReason('style', { curvePoint: { x: 0, y: 20 } })).toMatchObject({
      field: 'curvePoint.y',
      reason: 'out-of-range',
    });
    expect(drawableValuesReason('style', { elbowMiddle: 0.2 })).toBeUndefined();
  });
});
