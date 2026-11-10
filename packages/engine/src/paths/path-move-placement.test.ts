import { describe, expect, it } from 'vitest';

import { TransformTable } from '../gpu/transform-table.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument } from '../scene/__fixtures__/scene-objects.js';
import { AllVisibleCuller } from '../scene/scene-culler.js';
import type { ScenePassDrawer } from '../scene/scene-pass-drawer.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { PATH_CAMERA, squarePath } from './__fixtures__/path-scene.js';
import { INLINE_MESH_BUILDER } from './path-mesh-builder.js';
import { createPathPass } from './path-pass.js';

describe('retained path placement', () => {
  it('culls with the table placement and restores ordinary records on end', () => {
    const backend = new FakeGpuBackend();
    const pass = createPathPass({ meshBuilder: INLINE_MESH_BUILDER });
    let drawer: ScenePassDrawer | undefined;
    const renderer = new SceneRenderer(backend, {
      culler: new AllVisibleCuller(),
      passes: [
        {
          ...pass,
          createDrawer(setup) {
            drawer = pass.createDrawer?.(setup);
            if (!drawer) throw new Error('Expected the path drawer.');
            return drawer;
          },
        },
      ],
    });
    const document = new FakeSceneDocument();
    const object = squarePath('move', 0, { x: 5000, y: 5000 });
    document.create(object);
    renderer.enqueue(document.takeChanges());
    const frame = () => {
      renderer.renderFrame({ camera: PATH_CAMERA, timeMs: 0 });
    };
    frame();
    expect(backend.draws()).toHaveLength(0);
    const slots = renderer.scene.slotsOf(object.id, pass.name);
    const indexData = new Float32Array(Math.max(...slots) + 1);
    for (const slot of slots) indexData[slot] = 1;
    const indices = backend.createBuffer({ usage: 'vertex', byteLength: indexData.byteLength });
    backend.writeBuffer(indices, 0, indexData);
    const table = new TransformTable(backend, 1);
    table.set(1, { x: 10, y: 10, cos: 1, sin: 0 });
    table.flush();
    expect(typeof drawer?.setMovePlacement).toBe('function');
    drawer?.setMovePlacement?.({ table, indices, indexData });
    backend.resetCalls();
    frame();
    expect(backend.draws()).toHaveLength(3);
    expect(backend.calls.some((call) => call.method === 'setVertexBuffer' && call.slot === 2)).toBe(
      true,
    );
    table.set(1, { x: 5000, y: 5000, cos: 1, sin: 0 });
    table.flush();
    backend.resetCalls();
    frame();
    expect(backend.draws()).toHaveLength(0);
    table.set(1, { x: 10, y: 10, cos: 1, sin: 0 });
    table.flush();
    backend.resetCalls();
    frame();
    expect(backend.draws()).toHaveLength(3);
    drawer?.setMovePlacement?.(undefined);
    backend.resetCalls();
    frame();
    expect(backend.draws()).toHaveLength(0);
    renderer.destroy();
    table.destroy();
    indices.destroy();
  });
});
