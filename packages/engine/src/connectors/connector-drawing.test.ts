import { describe, expect, it, vi } from 'vitest';

import type { ConnectorObject, ObjectId } from '@canvas/schema';

import { createPathScene, PATH_CAMERA } from '../paths/__fixtures__/path-scene.js';
import type { MeshJobRequest } from '../paths/mesh-job-payload.js';
import { runMeshJob } from '../paths/mesh-job.js';
import { INLINE_MESH_BUILDER, type PathMeshBuilder } from '../paths/path-mesh-builder.js';
import { createPathPass } from '../paths/path-pass.js';
import { frameObject, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { connectorObject, lineObject } from '../spatial/__fixtures__/spatial-objects.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';

import { CONNECTOR_LEVEL_OF_DETAIL } from './connector-detail.js';

const id = (value: string): ObjectId => value as ObjectId;

/**
 * A connector from `a` to `b`, both automatic.
 *
 * @param fields - Fields to override.
 * @returns The connector.
 */
function linking(fields: Partial<ConnectorObject> = {}): ConnectorObject {
  return {
    ...connectorObject('c'),
    from: { kind: 'object', objectId: id('a'), anchor: null },
    to: { kind: 'object', objectId: id('b'), anchor: null },
    ...fields,
  };
}

/**
 * A path scene holding two boxes and a connector between them, drawn once.
 *
 * @param fields - Fields of the connector.
 * @returns The scene and its culler.
 */
function connectedScene(fields: Partial<ConnectorObject> = {}) {
  const culler = new SpatialCuller();
  const scene = createPathScene({ culler, draws: 'connectors' });
  scene.document.create(
    shapeObject('a', { x: 20, y: 20, width: 60, height: 40 }),
    shapeObject('b', { x: 250, y: 20, width: 60, height: 40 }),
    linking(fields),
  );
  scene.frame();
  return { ...scene, culler };
}

describe('connectors in the path pass', () => {
  it.each(['straight', 'elbow', 'curved'] as const)('draws a %s connector', (route) => {
    const { reports } = connectedScene({ route });
    expect(reports.at(-1)?.pathsDrawn).toBe(1);
    expect(reports.at(-1)?.meshesBuilt).toBe(1);
  });

  it('indexes a connector at its route, so it is culled like any object', () => {
    const { culler } = connectedScene();
    const bounds = culler.index.boundsOf(id('c'));
    expect(bounds?.minX).toBeLessThanOrEqual(80);
    expect(bounds?.maxX).toBeGreaterThanOrEqual(250);
  });

  it('meshes the re-routed connector in the frame its target moves', () => {
    const scene = connectedScene();
    scene.document.update('b', { y: 200 });
    scene.frame();
    expect(scene.reports.at(-1)?.meshesBuilt).toBe(1);
    const bounds = scene.culler.index.boundsOf(id('c'));
    expect(bounds?.maxY).toBeGreaterThanOrEqual(200);
  });

  it('sends a first mesh to the builder and meshes a re-route at once', async () => {
    const requests: MeshJobRequest[] = [];
    const builder: PathMeshBuilder = {
      build: (request) => {
        requests.push(request);
        return Promise.resolve(runMeshJob(request));
      },
    };
    const scene = createPathScene({ meshBuilder: builder, draws: 'connectors' });
    scene.document.create(
      shapeObject('a', { x: 20, y: 20, width: 60, height: 40 }),
      shapeObject('b', { x: 250, y: 20, width: 60, height: 40 }),
      linking(),
    );
    scene.frame();
    expect(requests).toHaveLength(1);
    await Promise.resolve();
    scene.frame();
    expect(scene.reports.at(-1)?.pathsDrawn).toBe(1);
    scene.document.update('b', { y: 200 });
    scene.frame();
    // Built on the rendering thread in the frame of the move; the builder saw nothing new.
    expect(requests).toHaveLength(1);
    expect(scene.reports.at(-1)?.meshesBuilt).toBe(1);
  });

  it('re-meshes a connector its frame carries away from targets outside it, in that frame', () => {
    const scene = createPathScene({ draws: 'connectors' });
    const frame = frameObject('f', { width: 400, height: 300 });
    scene.document.create(
      frame,
      shapeObject('a', { x: 20, y: 20, width: 60, height: 40 }),
      shapeObject('b', { x: 250, y: 20, width: 60, height: 40 }),
      { ...linking(), parentId: frame.id },
    );
    scene.frame();
    scene.document.update('f', { y: 100 });
    scene.frame();
    // Its targets stayed: its route in the moved frame is new, meshed in the frame of the move.
    expect(scene.reports.at(-1)?.meshesBuilt).toBe(1);
  });

  it('sends a new zoom bucket of an unchanged connector to the builder, not inline', () => {
    const build = vi.fn(runMeshJob);
    const scene = createPathScene({ meshBuilder: { build }, draws: 'connectors' });
    scene.document.create(connectorObject('c'));
    scene.frame();
    expect(build).toHaveBeenCalledTimes(1);
    expect(scene.reports.at(-1)?.bucket).toBe(0);
    scene.frame({ ...PATH_CAMERA, zoom: 2 ** 0.4 });
    expect(scene.reports.at(-1)?.bucket).toBe(1);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('hides a connector whose stroke is under half a device pixel, with a band against flicker', () => {
    const scene = connectedScene();
    const at = (zoom: number) => {
      scene.frame({ ...PATH_CAMERA, zoom });
      return scene.reports.at(-1);
    };
    // A 2-wide stroke: 0.4 px at 20%, hidden, so nothing is meshed or drawn.
    expect(at(0.2)?.pathsDrawn).toBe(0);
    expect(at(0.2)?.meshesBuilt).toBe(0);
    // 0.52 px is over the threshold but inside its 20% band: still hidden.
    expect(at(0.26)?.pathsDrawn).toBe(0);
    // 0.62 px leaves the band: drawn again; and back inside the band it stays drawn.
    expect(at(0.31)?.pathsDrawn).toBe(1);
    expect(at(0.26)?.pathsDrawn).toBe(1);
    expect(scene.renderer.scene.levelOfDetail.formOf('connector', id('c'))).toBe('full');
  });

  it('makes connectors occlude nothing, so they never split the z-order segments', () => {
    const connectors = createPathPass({ meshBuilder: INLINE_MESH_BUILDER, draws: 'connectors' });
    const paths = createPathPass({ meshBuilder: INLINE_MESH_BUILDER });
    expect(connectors.recordCount(linking())).toBe(1);
    expect(connectors.isOccluder?.(linking())).toBe(false);
    expect(paths.recordCount(linking())).toBe(0);
    expect(paths.isOccluder?.(lineObject('l'))).toBe(true);
  });

  it('measures a connector by its stroke, so a re-route measures nothing again', () => {
    const connector: ConnectorObject = { ...linking(), stroke: { color: [0, 0, 0, 1], width: 3 } };
    expect(CONNECTOR_LEVEL_OF_DETAIL.sizeOf(connector)).toBe(3);
    expect(CONNECTOR_LEVEL_OF_DETAIL.sizeOf(shapeObject('s'))).toBe(0);
    const isSameSize = CONNECTOR_LEVEL_OF_DETAIL.isSameSize;
    expect(isSameSize?.(connector, { ...connector, x: 90 })).toBe(true);
    expect(
      isSameSize?.(connector, { ...connector, stroke: { ...connector.stroke, width: 1 } }),
    ).toBe(false);
    expect(isSameSize?.(connector, shapeObject('c'))).toBe(false);
  });

  it('builds nothing on a frame that only moves the camera', () => {
    const scene = connectedScene();
    scene.frame({ ...PATH_CAMERA, x: 5 });
    expect(scene.reports.at(-1)?.meshesBuilt).toBe(0);
  });

  it('builds nothing when an object nothing is attached to moves', () => {
    const scene = connectedScene();
    scene.document.create(shapeObject('lonely', { x: 100, y: 200 }));
    scene.frame();
    scene.document.update('lonely', { x: 140 });
    scene.frame();
    expect(scene.reports.at(-1)?.meshesBuilt).toBe(0);
  });

  it('stops drawing a connector that is deleted', () => {
    const scene = connectedScene();
    scene.document.delete('c');
    scene.frame();
    expect(scene.reports.at(-1)?.pathsDrawn).toBe(0);
    expect(scene.culler.index.boundsOf(id('c'))).toBeUndefined();
  });
});
