import { expect, it } from 'vitest';

import { createPathScene, squarePath, zigzagPath } from './__fixtures__/path-scene.js';

const stroke = (id: string, rank: number, alpha = 1) =>
  zigzagPath(id, rank, { x: 100, y: 10, stroke: { color: [0, 0, 0, alpha], width: 4 } });

it('keeps the old per-path command stream when isBatched is false', () => {
  const scene = createPathScene({ isBatched: false });
  scene.document.create(stroke('a', 0), squarePath('fill', 1), stroke('alpha', 2, 0.5));
  scene.frame();
  expect(scene.backend.draws().every(({ instanceCount }) => instanceCount === 1)).toBe(true);
  const begin = scene.backend.calls.findIndex(({ method }) => method === 'beginRenderPass');
  expect(scene.backend.calls.slice(begin)).toMatchInlineSnapshot(`
      [
        {
          "method": "beginRenderPass",
          "target": undefined,
          "timingLabel": undefined,
        },
        {
          "label": "path instances",
          "method": "setVertexBuffer",
          "slot": 1,
        },
        {
          "label": "path mesh",
          "method": "setVertexBuffer",
          "slot": 0,
        },
        {
          "label": "path stroke",
          "method": "setPipeline",
        },
        {
          "method": "createBindGroup",
        },
        {
          "method": "setBindGroup",
          "textureLabel": "clip-table",
        },
        {
          "firstInstance": 0,
          "firstVertex": 6,
          "instanceCount": 1,
          "method": "draw",
          "target": undefined,
          "vertexCount": 42,
        },
        {
          "label": "path fill stencil",
          "method": "setPipeline",
        },
        {
          "firstInstance": 1,
          "firstVertex": 48,
          "instanceCount": 1,
          "method": "draw",
          "target": undefined,
          "vertexCount": 6,
        },
        {
          "label": "path fill cover",
          "method": "setPipeline",
        },
        {
          "firstInstance": 1,
          "firstVertex": 54,
          "instanceCount": 1,
          "method": "draw",
          "target": undefined,
          "vertexCount": 6,
        },
        {
          "label": "path stroke",
          "method": "setPipeline",
        },
        {
          "firstInstance": 2,
          "firstVertex": 60,
          "instanceCount": 1,
          "method": "draw",
          "target": undefined,
          "vertexCount": 48,
        },
        {
          "label": "path stroke once",
          "method": "setPipeline",
        },
        {
          "firstInstance": 3,
          "firstVertex": 114,
          "instanceCount": 1,
          "method": "draw",
          "target": undefined,
          "vertexCount": 42,
        },
        {
          "label": "path stencil clear",
          "method": "setPipeline",
        },
        {
          "firstInstance": 3,
          "firstVertex": 108,
          "instanceCount": 1,
          "method": "draw",
          "target": undefined,
          "vertexCount": 6,
        },
        {
          "method": "endPass",
        },
        {
          "method": "submit",
        },
      ]
    `);
  scene.renderer.destroy();
});
