// Draw order through the FULL standard pass list, with the bundled fonts so text draws too:
// a renderer as the engine hosts build it, and its last frame read back as
// `pass:object` per run of an object's records in a pass, for ordering tests.
import type { Camera } from '../../../camera/camera.js';
import { FontLibrary } from '../../../text/font/font-library.js';
import { addBundledFaces } from '../../../text/scene/__fixtures__/text-objects.js';
import { createDefaultJobHandlers } from '../../../workers/default-job-handlers.js';
import { WorkerPool } from '../../../workers/worker-pool.js';
import { FakeGpuBackend } from '../../__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument } from '../../__fixtures__/scene-objects.js';
import { SceneRenderer } from '../../scene-renderer.js';
import { createStandardScenePasses } from '../../standard-passes.js';

/** The origin at 100%, 800 × 600. */
export const STANDARD_CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 1,
};

/** The standard passes' names, longest first, so a pipeline label is matched to its own. */
const PASS_NAMES = [
  'rounded-rect-gradient',
  'sdf-shape-gradient',
  'path-gradient',
  'rect-gradient',
  'frame-shadow',
  'frame-stroke',
  'frame-title',
  'rounded-rect',
  'solid-rect',
  'sdf-shape',
  'connector',
  'image',
  'image-border',
  'path',
  'text',
];

/**
 * The pass a pipeline belongs to, by its label (`<pass>` or `<pass> <variant>`).
 *
 * @param label - The pipeline's label.
 * @returns The pass name, or the label itself.
 */
function passOfLabel(label: string): string {
  return PASS_NAMES.find((name) => label === name || label.startsWith(`${name} `)) ?? label;
}

/** A renderer over the standard passes with fonts, and the board it draws. */
export interface Drawn {
  readonly renderer: SceneRenderer;
  readonly backend: FakeGpuBackend;
  readonly pool: WorkerPool;
  readonly document: FakeSceneDocument;
}

/**
 * A renderer over the standard passes, with the bundled fonts for text.
 *
 * @param pools - Where its job pool is listed, for the caller to terminate.
 * @returns The renderer, its backend and pool, and an empty document.
 */
export function createDrawn(pools: WorkerPool[]): Drawn {
  const fonts = new FontLibrary();
  addBundledFaces(fonts);
  const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: createDefaultJobHandlers() });
  pools.push(pool);
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: createStandardScenePasses({ jobs: pool }),
    environment: { text: { fonts, jobs: pool } },
  });
  return { renderer, backend, pool, document: new FakeSceneDocument() };
}

/**
 * Renders until meshes and glyphs have landed, then reads the last frame's draw order: one
 * `pass:object` per run of an object's records in a pass.
 *
 * @param drawn - The renderer, its backend and pool.
 * @returns The draw order.
 */
export async function drawOrder(drawn: Drawn): Promise<string[]> {
  const { renderer, backend, pool } = drawn;
  for (let frame = 0; frame < 6; frame += 1) {
    renderer.renderFrame({ timeMs: frame * 16, camera: STANDARD_CAMERA });
    pool.drainMainThread(Number.POSITIVE_INFINITY, () => 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  backend.resetCalls();
  renderer.renderFrame({ timeMs: 200, camera: STANDARD_CAMERA });
  const owners = new Map<string, Map<number, string>>();
  for (const { name } of renderer.scene.passes) {
    const bySlot = new Map<number, string>();
    for (const [id, slots] of renderer.scene.slotEntriesOf(name)) {
      for (const slot of slots) bySlot.set(slot, id);
    }
    owners.set(name, bySlot);
  }
  const order: string[] = [];
  let pass = '';
  for (const call of backend.calls) {
    if (call.method === 'setPipeline') pass = passOfLabel(call.label);
    if (call.method !== 'draw') continue;
    for (let index = 0; index < call.instanceCount; index += 1) {
      const owner = owners.get(pass)?.get(call.firstInstance + index);
      const entry = `${pass}:${owner ?? '?'}`;
      if (owner !== undefined && order.at(-1) !== entry) order.push(entry);
    }
  }
  return order;
}
