import { describe, expect, expectTypeOf, it } from 'vitest';

import * as schema from '@canvas/schema';
import type {
  CapShape as SchemaCapShape,
  ConnectorPath as SchemaConnectorPath,
  ConnectorShape as SchemaConnectorShape,
  Cubic as SchemaCubic,
  DashPattern as SchemaDashPattern,
  LineShape as SchemaLineShape,
  LineShapeInput as SchemaLineShapeInput,
  StrokeCaps as SchemaStrokeCaps,
  StrokeCapStyle as SchemaStrokeCapStyle,
  StrokeOutline as SchemaStrokeOutline,
} from '@canvas/schema';

import * as engine from '../index.js';
import type {
  CapShape as EngineCapShape,
  ConnectorPath as EngineConnectorPath,
  ConnectorShape as EngineConnectorShape,
  Cubic as EngineCubic,
  DashPattern as EngineDashPattern,
  LineShape as EngineLineShape,
  LineShapeInput as EngineLineShapeInput,
  StrokeCaps as EngineStrokeCaps,
  StrokeCapStyle as EngineStrokeCapStyle,
  StrokeOutline as EngineStrokeOutline,
} from '../index.js';
import { capShaftInset, capShaftStyle } from '../paths/caps.js';
import { connectorObject } from '../spatial/__fixtures__/spatial-objects.js';

import { connectorPolylineOf } from './connector-label.js';
import { connectorShapeFrom } from './connector-shape.js';

describe('moved geometry keeps the engine exports identical', () => {
  it('preserves the engine geometry types', () => {
    expectTypeOf<EngineCubic>().toEqualTypeOf<SchemaCubic>();
    expectTypeOf<EngineConnectorPath>().toEqualTypeOf<SchemaConnectorPath>();
    expectTypeOf<EngineConnectorShape>().toEqualTypeOf<SchemaConnectorShape>();
    expectTypeOf<EngineCapShape>().toEqualTypeOf<SchemaCapShape>();
    expectTypeOf<EngineStrokeCapStyle>().toEqualTypeOf<SchemaStrokeCapStyle>();
    expectTypeOf<EngineStrokeCaps>().toEqualTypeOf<SchemaStrokeCaps>();
    expectTypeOf<EngineDashPattern>().toEqualTypeOf<SchemaDashPattern>();
    expectTypeOf<EngineStrokeOutline>().toEqualTypeOf<SchemaStrokeOutline>();
    expectTypeOf<EngineLineShape>().toEqualTypeOf<SchemaLineShape>();
    expectTypeOf<EngineLineShapeInput>().toEqualTypeOf<SchemaLineShapeInput>();
  });

  it('re-exports the pure cubic functions', () => {
    expect(engine.evalCubic).toBe(schema.evalCubic);
    expect(engine.splitCubic).toBe(schema.splitCubic);
    expect(engine.isStraightCubic).toBe(schema.isStraightCubic);
    expect(engine.flattenCubic).toBe(schema.flattenCubic);
  });

  it('re-exports the flatten bucket functions and values', () => {
    expect(engine.FLATTEN_TOLERANCE_PX).toBe(schema.FLATTEN_TOLERANCE_PX);
    expect(engine.FLATTEN_BUCKET_HYSTERESIS).toBe(schema.FLATTEN_BUCKET_HYSTERESIS);
    expect(engine.pickFlattenBucket).toBe(schema.pickFlattenBucket);
    expect(engine.flattenToleranceOf).toBe(schema.flattenToleranceOf);
  });

  it('re-exports connector routing and label functions', () => {
    expect(engine.ELBOW_STUB).toBe(schema.ELBOW_STUB);
    expect(engine.CURVE_HANDLE_FRACTION).toBe(schema.CURVE_HANDLE_FRACTION);
    expect(engine.elbowConnectorRoute).toBe(schema.elbowConnectorRoute);
    expect(engine.curvedConnectorCubic).toBe(schema.curvedConnectorCubic);
    expect(engine.connectorPathOf).toBe(schema.connectorPathOf);
    expect(connectorPolylineOf).toBe(schema.connectorPolylineOf);
    expect(engine.connectorLabelPoint).toBe(schema.connectorLabelPoint);
    expect(connectorShapeFrom).toBe(schema.connectorShapeFrom);
  });

  it('re-exports cap and stroke cap geometry', () => {
    expect(engine.capLength).toBe(schema.capLength);
    expect(engine.capLengthOn).toBe(schema.capLengthOn);
    expect(engine.capShapeOf).toBe(schema.capShapeOf);
    expect(capShaftInset).toBe(schema.capShaftInset);
    expect(capShaftStyle).toBe(schema.capShaftStyle);
    expect(engine.capReach).toBe(schema.capReach);
    expect(engine.resolveCaps).toBe(schema.resolveCaps);
  });

  it('re-exports stroke outline geometry', () => {
    expect(engine.PLAIN_OUTLINE).toBe(schema.PLAIN_OUTLINE);
    expect(engine.strokeOutlineOf).toBe(schema.strokeOutlineOf);
    expect(engine.isSameStrokeStyle).toBe(schema.isSameStrokeStyle);
    expect(engine.strokeOutlineReach).toBe(schema.strokeOutlineReach);
    expect(engine.roundJoined).toBe(schema.roundJoined);
  });

  it('re-exports line geometry and routing', () => {
    expect(engine.lineShapeOf).toBe(schema.lineShapeOf);
    expect(engine.elbowRoute).toBe(schema.elbowRoute);
    expect(engine.lineRouteOf).toBe(schema.lineRouteOf);
  });

  it('still derives a hand-built connector shape from its free ends', () => {
    const connector = {
      ...connectorObject('c'),
      from: { kind: 'point' as const, x: 30, y: 40 },
      to: { kind: 'point' as const, x: 90, y: 40 },
    };
    const from = { point: { x: 30, y: 40 }, normal: null };
    const to = { point: { x: 90, y: 40 }, normal: null };
    expect(engine.connectorShapeOf(connector)).toEqual(connectorShapeFrom(connector, from, to));
    expect(engine.connectorShapeOf(connector)).toBe(engine.connectorShapeOf(connector));
  });
});
