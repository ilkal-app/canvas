import { describe, expect, it } from 'vitest';

import type { PlacedConnectorEnd } from '@canvas/schema';

import {
  connectorPathOf,
  CURVE_HANDLE_FRACTION,
  curvedConnectorCubic,
  ELBOW_STUB,
  elbowConnectorRoute,
} from './connector-path.js';

const free = (x: number, y: number): PlacedConnectorEnd => ({ point: { x, y }, normal: null });
const facing = (x: number, y: number, nx: number, ny: number): PlacedConnectorEnd => ({
  point: { x, y },
  normal: { x: nx, y: ny },
});

describe('elbowConnectorRoute', () => {
  it('runs straight out of facing sides and bends once each way through the middle', () => {
    const route = elbowConnectorRoute(facing(0, 0, 1, 0), facing(200, 100, -1, 0));
    expect(route).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
  });

  it('bends once where a horizontal and a vertical side cross ahead of both', () => {
    const route = elbowConnectorRoute(facing(0, 0, 1, 0), facing(200, 100, 0, -1));
    expect(route).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
    ]);
  });

  it('goes round through the middle when the ends face away from each other', () => {
    // The start leaves rightwards, but the end lies to its left, facing left.
    const route = elbowConnectorRoute(facing(200, 0, 1, 0), facing(0, 100, -1, 0));
    expect(route).toEqual([
      { x: 200, y: 0 },
      { x: 200 + ELBOW_STUB, y: 0 },
      { x: 200 + ELBOW_STUB, y: 50 },
      { x: -ELBOW_STUB, y: 50 },
      { x: -ELBOW_STUB, y: 100 },
      { x: 0, y: 100 },
    ]);
  });

  it('bends once from a vertical side into a horizontal one ahead of both', () => {
    const route = elbowConnectorRoute(facing(0, 0, 0, 1), facing(200, 100, -1, 0));
    expect(route).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 200, y: 100 },
    ]);
  });

  it('leaves across a stub when the corner of the two axes lies behind an end', () => {
    // The start leaves rightwards; the end, below it, faces down, away from the start.
    const route = elbowConnectorRoute(facing(0, 0, 1, 0), facing(200, 100, 0, 1));
    expect(route).toEqual([
      { x: 0, y: 0 },
      { x: ELBOW_STUB, y: 0 },
      { x: ELBOW_STUB, y: 100 + ELBOW_STUB },
      { x: 200, y: 100 + ELBOW_STUB },
      { x: 200, y: 100 },
    ]);
    const fromAbove = elbowConnectorRoute(facing(0, 0, 0, -1), facing(200, 100, 1, 0));
    expect(fromAbove).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: -ELBOW_STUB },
      { x: 200 + ELBOW_STUB, y: -ELBOW_STUB },
      { x: 200 + ELBOW_STUB, y: 100 },
      { x: 200, y: 100 },
    ]);
  });

  it('goes round through the middle when vertical sides face away from each other', () => {
    const route = elbowConnectorRoute(facing(0, 200, 0, 1), facing(100, 0, 0, -1));
    expect(route).toEqual([
      { x: 0, y: 200 },
      { x: 0, y: 200 + ELBOW_STUB },
      { x: 50, y: 200 + ELBOW_STUB },
      { x: 50, y: -ELBOW_STUB },
      { x: 100, y: -ELBOW_STUB },
      { x: 100, y: 0 },
    ]);
  });

  it('leaves free ends along the axis the other end is further away on', () => {
    expect(elbowConnectorRoute(free(0, 0), free(40, 20))).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 40, y: 20 },
    ]);
    expect(elbowConnectorRoute(free(0, 0), free(10, 60))).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 30 },
      { x: 10, y: 30 },
      { x: 10, y: 60 },
    ]);
  });

  it('keeps only real corners: aligned ends give one piece, coincident ends one point', () => {
    expect(elbowConnectorRoute(free(0, 0), free(50, 0))).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ]);
    expect(elbowConnectorRoute(free(5, 5), free(5, 5))).toEqual([{ x: 5, y: 5 }]);
  });

  it('snaps a turned side to the nearer axis', () => {
    const turned = facing(0, 0, Math.cos(0.2), Math.sin(0.2));
    const route = elbowConnectorRoute(turned, facing(200, 0, -1, 0));
    expect(route).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
  });
});

describe('curvedConnectorCubic', () => {
  it('reaches along each normal by a fraction of the span', () => {
    const cubic = curvedConnectorCubic(facing(0, 0, 0, 1), facing(100, 0, 0, 1));
    const reach = 100 * CURVE_HANDLE_FRACTION;
    expect(cubic).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: reach },
      { x: 100, y: reach },
      { x: 100, y: 0 },
    ]);
  });

  it('is straight between two free ends', () => {
    const cubic = curvedConnectorCubic(free(0, 0), free(90, 0));
    expect(cubic).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
      { x: 90, y: 0 },
    ]);
  });
});

describe('connectorPathOf', () => {
  it('routes straight, elbow and curved', () => {
    const from = facing(0, 0, 1, 0);
    const to = facing(100, 50, -1, 0);
    expect(connectorPathOf(from, to, 'straight')).toEqual({
      route: [from.point, to.point],
      curve: undefined,
    });
    expect(connectorPathOf(from, to, 'elbow').route).toHaveLength(4);
    const curved = connectorPathOf(from, to, 'curved');
    expect(curved.route).toEqual([from.point, to.point]);
    expect(curved.curve?.[0]).toEqual(from.point);
    expect(curved.curve?.[3]).toEqual(to.point);
  });
});
