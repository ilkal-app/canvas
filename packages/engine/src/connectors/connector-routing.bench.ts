import { bench, describe } from 'vitest';

import type { BoardObject, ConnectorObject } from '@canvas/schema';

import { meshJobRequestOf, runMeshJob } from '../paths/mesh-job.js';
import { sourceOf, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { benchSize } from '../spatial/__fixtures__/bench-size.js';
import { connectorObject } from '../spatial/__fixtures__/spatial-objects.js';

import { connectorPlacementKey } from './connector-placement-key.js';
import { resolveConnectorShape, type ConnectorTargetSource } from './connector-placement.js';
import { placedConnector } from './connector-shape.js';

// CPU cost of re-routing connectors: what a frame does for each
// connector whose target moved (placing its ends on the targets' boxes and routing it) and, for
// one drawn on screen, meshing the new route at once on the rendering thread. The 50k board holds
// 7,000 connectors (14% of its objects); a drag moves a handful of targets, so a frame re-routes
// a handful, while a select-all drag of every frame re-places every connector the scene reads
// again. The frame-time suite measures them through the real engine host (tooling/bench,
// `drag-object-connected`, `zoom-sweep-connected`).

/** The 50k board's connectors. */
const CONNECTOR_COUNT = benchSize({ full: 7000, smoke: 700 });
const ROUTES: readonly ConnectorObject['route'][] = ['straight', 'elbow', 'curved'];

describe(`${String(CONNECTOR_COUNT)} connectors between boxes`, () => {
  const objects: BoardObject[] = [];
  const connectors: ConnectorObject[] = [];
  for (let index = 0; index < CONNECTOR_COUNT; index += 1) {
    const x = (index % 70) * 300;
    const y = Math.floor(index / 70) * 300;
    const from = shapeObject(`a${String(index)}`, { x, y, width: 120, height: 80 });
    const to = shapeObject(`b${String(index)}`, { x: x + 180, y: y + 120, width: 120, height: 80 });
    const connector: ConnectorObject = {
      ...connectorObject(`c${String(index)}`),
      from: { kind: 'object', objectId: from.id, anchor: null },
      to: { kind: 'object', objectId: to.id, anchor: null },
      route: ROUTES[index % ROUTES.length] ?? 'straight',
    };
    objects.push(from, to, connector);
    connectors.push(connector);
  }
  const source: ConnectorTargetSource = { ...sourceOf(objects), childrenOf: () => [] };

  bench('place and route every connector', () => {
    for (const connector of connectors) resolveConnectorShape(connector, source);
  });

  bench('check what every connector is placed from (a rigid move of its frame)', () => {
    for (const connector of connectors) connectorPlacementKey(connector, source);
  });

  const placed = connectors.map((connector) =>
    placedConnector(connector, resolveConnectorShape(connector, source)),
  );
  const requests = placed.map((connector) => meshJobRequestOf(connector, 1, 0));
  bench('mesh every connector at one zoom bucket', () => {
    for (const request of requests) runMeshJob(request);
  });
});
