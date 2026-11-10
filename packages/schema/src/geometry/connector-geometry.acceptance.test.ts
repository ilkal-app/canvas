import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';

import * as schema from '../index.js';
import type {
  CapShape as SchemaCapShape,
  ConnectorPath as SchemaConnectorPath,
  ConnectorShape as SchemaConnectorShape,
  Cubic as SchemaCubic,
  DashPattern as SchemaDashPattern,
  LineCap,
  LineShape as SchemaLineShape,
  LineShapeInput as SchemaLineShapeInput,
  PlacedConnectorEnd,
  Point,
  StrokeCaps as SchemaStrokeCaps,
  StrokeCapStyle as SchemaStrokeCapStyle,
  StrokeOutline as SchemaStrokeOutline,
  StrokeStyle,
} from '../index.js';

type Cubic = readonly [Point, Point, Point, Point];
type CapShape =
  | { readonly kind: 'stroke' | 'polygon'; readonly points: readonly Point[] }
  | { readonly kind: 'disc'; readonly centre: Point; readonly radius: number };
interface ConnectorPath {
  readonly route: readonly Point[];
  readonly curve: Cubic | undefined;
}
interface GeometryExports {
  connectorPathOf(
    from: PlacedConnectorEnd,
    to: PlacedConnectorEnd,
    route: 'straight' | 'elbow' | 'curved',
  ): ConnectorPath;
  connectorLabelPoint(path: ConnectorPath): Point;
  connectorPolylineOf(path: ConnectorPath): readonly Point[];
  connectorShapeFrom(
    connector: { readonly route: 'straight' | 'elbow' | 'curved' },
    from: PlacedConnectorEnd,
    to: PlacedConnectorEnd,
  ): { readonly path: ConnectorPath; readonly label: Point };
  capLength(width: number): number;
  capLengthOn(width: number, lineLength?: number): number;
  capShapeOf(cap: LineCap, tip: Point, outward: Point, width: number): CapShape | undefined;
  capShaftInset(cap: LineCap, width: number): number;
  capShaftStyle(cap: LineCap): 'round' | 'butt' | 'square';
  capReach(cap: LineCap, width: number): number;
  lineShapeOf(
    input: {
      readonly route: readonly Point[];
      readonly startCap: LineCap;
      readonly endCap: LineCap;
    },
    width: number,
  ): {
    readonly shaft: readonly Point[];
    readonly shaftCaps: { readonly start: string; readonly end: string };
    readonly heads: readonly CapShape[];
  };
  resolveCaps(option: 'round' | 'butt' | 'square'): {
    readonly start: string;
    readonly end: string;
  };
  lineRouteOf(line: {
    readonly points: readonly [Point, Point];
    readonly route: 'straight' | 'elbow';
  }): Point[];
  flattenCubic(cubic: Cubic, tolerance: number): Point[];
  evalCubic(cubic: Cubic, t: number): Point;
  pickFlattenBucket(zoom: number): number;
  flattenToleranceOf(bucket: number): number;
  strokeOutlineOf(style: StrokeStyle): object;
  isSameStrokeStyle(a: StrokeStyle, b: StrokeStyle): boolean;
  strokeOutlineReach(width: number, outline: object): number;
  roundJoined(outline: object): object;
}

// The adapter types the future schema exports while this acceptance suite runs before the move.
const geometry = schema as unknown as GeometryExports;

const from = { point: { x: 0, y: 0 }, normal: { x: 1, y: 0 } };
const to = { point: { x: 100, y: 50 }, normal: { x: -1, y: 0 } };
const route = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
] as const;
const arch = [
  { x: 0, y: 0 },
  { x: 0, y: 100 },
  { x: 100, y: 100 },
  { x: 100, y: 0 },
] as const;

describe('schema connector geometry', () => {
  it('exports the moved geometry types', () => {
    expectTypeOf<SchemaCubic>().toEqualTypeOf<Cubic>();
    expectTypeOf<SchemaConnectorPath>().toExtend<ConnectorPath>();
    expectTypeOf<SchemaConnectorShape>().toBeObject();
    expectTypeOf<SchemaCapShape>().toBeObject();
    expectTypeOf<SchemaStrokeCapStyle>().toExtend<string>();
    expectTypeOf<SchemaStrokeCaps>().toBeObject();
    expectTypeOf<SchemaDashPattern>().toBeObject();
    expectTypeOf<SchemaStrokeOutline>().toBeObject();
    expectTypeOf<SchemaLineShape>().toBeObject();
    expectTypeOf<SchemaLineShapeInput>().toBeObject();
  });

  it('routes straight, elbow, and curved connectors', () => {
    const straight = geometry.connectorPathOf(from, to, 'straight');
    expect(straight).toEqual({ route: [from.point, to.point], curve: undefined });

    const elbow = geometry.connectorPathOf(from, to, 'elbow');
    expect(elbow.route).toHaveLength(4);

    const curved = geometry.connectorPathOf(from, to, 'curved');
    expect(curved.route).toEqual([from.point, to.point]);
    expect(curved.curve?.[0]).toEqual(from.point);
    expect(curved.curve?.[3]).toEqual(to.point);
  });

  it('uses the engine midpoint rules for an elbow and a symmetric curve', () => {
    expect(
      geometry.connectorLabelPoint({
        route: [
          { x: 0, y: 0 },
          { x: 100, y: 40 },
        ],
        curve: undefined,
      }),
    ).toEqual({ x: 50, y: 20 });
    expect(
      geometry.connectorLabelPoint({
        route: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 20 },
          { x: 120, y: 20 },
        ],
        curve: undefined,
      }),
    ).toEqual({ x: 70, y: 0 });
    const curve = geometry.connectorPathOf(
      { point: { x: 0, y: 0 }, normal: { x: 0, y: 1 } },
      { point: { x: 100, y: 0 }, normal: { x: 0, y: 1 } },
      'curved',
    );
    expect(geometry.connectorLabelPoint(curve).x).toBeCloseTo(50, 6);
    expect(geometry.connectorLabelPoint(curve).y).toBeCloseTo(30, 0);
    expect(geometry.connectorPolylineOf(curve).length).toBeGreaterThan(2);
  });

  it('builds a connector shape from placed ends', () => {
    const start = { point: { x: 0, y: 0 }, normal: null };
    const end = { point: { x: 100, y: 40 }, normal: null };
    const shape = geometry.connectorShapeFrom({ route: 'straight' }, start, end);
    expect(shape).toEqual({
      path: { route: [start.point, end.point], curve: undefined },
      label: { x: 50, y: 20 },
    });
  });

  it('keeps every cap shape and shaft inset', () => {
    const tip = { x: 100, y: 0 };
    const outward = { x: 1, y: 0 };
    const length = geometry.capLength(2);
    expect(geometry.capLengthOn(2, 10)).toBe(5);
    expect(geometry.capShapeOf('none', tip, outward, 2)).toBeUndefined();
    expect(geometry.capShapeOf('arrow', tip, outward, 2)).toEqual({
      kind: 'stroke',
      points: [{ x: 100 - length, y: length / 2 }, tip, { x: 100 - length, y: -length / 2 }],
    });
    expect(geometry.capShapeOf('triangle', tip, outward, 2)).toEqual({
      kind: 'polygon',
      points: [tip, { x: 100 - length, y: length / 2 }, { x: 100 - length, y: -length / 2 }],
    });
    expect(geometry.capShapeOf('circle', tip, outward, 2)).toMatchObject({
      kind: 'disc',
      centre: tip,
    });
    const diamond = geometry.capShapeOf('diamond', tip, outward, 2);
    expect(diamond?.kind).toBe('polygon');
    for (const cap of schema.LINE_CAPS) {
      expect(geometry.capShaftInset(cap, 2)).toBe(cap === 'triangle' ? length / 2 : 0);
    }
    expect(geometry.capShaftStyle('triangle')).toBe('butt');
    expect(geometry.capShaftStyle('arrow')).toBe('round');
    expect(geometry.capReach('none', 2)).toBe(1);
  });

  it('pulls the line shaft back under a triangle and produces its head', () => {
    const shape = geometry.lineShapeOf({ route, startCap: 'none', endCap: 'triangle' }, 2);
    expect(shape.shaft.at(-1)).toEqual({ x: 100 - geometry.capLength(2) / 2, y: 0 });
    expect(shape.shaftCaps.end).toBe('butt');
    expect(shape.heads).toHaveLength(1);
    expect(shape.heads[0]?.kind === 'polygon' && shape.heads[0].points[0]).toEqual({
      x: 100,
      y: 0,
    });
    expect(geometry.resolveCaps('round')).toEqual({ start: 'round', end: 'round' });
  });

  it('gives a coincident-ends line no heads and round shaft ends', () => {
    const point = { x: 5, y: 5 };
    expect(
      geometry.lineShapeOf({ route: [point, point], startCap: 'arrow', endCap: 'circle' }, 2),
    ).toEqual({ shaft: [point, point], shaftCaps: { start: 'round', end: 'round' }, heads: [] });
  });

  it('routes an elbow line through the middle of its longer axis', () => {
    expect(
      geometry.lineRouteOf({
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 40 },
        ],
        route: 'elbow',
      }),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 40 },
    ]);
  });

  it('flattens a cubic within the engine tolerance', () => {
    const polyline = geometry.flattenCubic(arch, 0.25);
    expect(geometry.evalCubic(arch, 0.5)).toEqual({ x: 50, y: 75 });
    expect(polyline[0]).toEqual(arch[0]);
    expect(polyline.at(-1)).toEqual(arch[3]);
    expect(polyline.length).toBeGreaterThan(geometry.flattenCubic(arch, 2).length);
    for (let step = 0; step <= 400; step += 1) {
      const point = geometry.evalCubic(arch, step / 400);
      let nearest = Number.POSITIVE_INFINITY;
      for (let index = 1; index < polyline.length; index += 1) {
        const a = polyline[index - 1] ?? point;
        const b = polyline[index] ?? point;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const fraction = Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)),
        );
        nearest = Math.min(
          nearest,
          Math.hypot(point.x - a.x - fraction * dx, point.y - a.y - fraction * dy),
        );
      }
      expect(nearest).toBeLessThanOrEqual(0.25 * 1.0001);
    }
  });

  it('keeps the flatten bucket and dashed stroke outline values', () => {
    expect(schema.FLATTEN_TOLERANCE_PX).toBe(0.25);
    expect(schema.FLATTEN_BUCKET_HYSTERESIS).toBe(0.25);
    expect(geometry.pickFlattenBucket(2)).toBe(2);
    expect(geometry.flattenToleranceOf(2)).toBe(0.125);
    expect(
      geometry.strokeOutlineOf({
        strokeDash: { pattern: [4, 2] },
        strokeJoin: 'bevel',
        strokeMiterLimit: 6,
        strokeCap: 'square',
      }),
    ).toEqual({
      dash: { pattern: [4, 2], offset: 0 },
      join: 'bevel',
      miterLimit: 6,
      cap: 'square',
    });
    expect(geometry.strokeOutlineOf({})).toBe(schema.PLAIN_OUTLINE);
    expect(geometry.isSameStrokeStyle({}, { strokeDash: null })).toBe(true);
    expect(geometry.strokeOutlineReach(4, { join: 'miter' })).toBe(8);
    expect(geometry.roundJoined({ join: 'miter', cap: 'butt' })).toEqual({ cap: 'butt' });
  });
});

describe('schema geometry purity', () => {
  it('keeps each moved geometry module free of engine imports and DOM globals', () => {
    const files = [
      'bezier.ts',
      'flatten-bucket.ts',
      'connector-path.ts',
      'connector-label.ts',
      'connector-shape.ts',
      'caps.ts',
      'stroke-caps.ts',
      'stroke-outline.ts',
      'line-shape.ts',
      'elbow-route.ts',
    ];
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/(?:from\s*['"]|import\s*\(['"])@canvas\/engine(?:\/|['"])/);
      expect(source, file).not.toMatch(
        /\b(?:window|document)\s*(?:\.|\[)|\b(?:HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|WebGLRenderingContext|GPUDevice)\b/,
      );
    }
  });
});
