// A SceneRenderer with the path pass over the fake backend, for the path pass's tests.
import type { PathObject } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { MemoryLedger } from '../../diagnostics/memory-ledger.js';
import { reportSceneMemory } from '../../diagnostics/scene-memory.js';
import { FakeGpuBackend } from '../../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, zKeyAt } from '../../scene/__fixtures__/scene-objects.js';
import type { FrameContext } from '../../scene/frame-context.js';
import type { SceneCuller } from '../../scene/scene-culler.js';
import type { ScenePass } from '../../scene/scene-pass.js';
import { SceneRenderer } from '../../scene/scene-renderer.js';
import { pathObject } from '../../spatial/__fixtures__/spatial-objects.js';
import type { PathFrameReport } from '../path-frame-report.js';
import { INLINE_MESH_BUILDER } from '../path-mesh-builder.js';
import { createPathPass, type PathPassOptions } from '../path-pass.js';

/** A camera at zoom 1, dpr 1, showing world (0, 0) to (400, 300). */
export const PATH_CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 400,
  viewportHeightPx: 300,
  dpr: 1,
};

/** A path pass test bench: backend, renderer, document, and each frame's report. */
export interface PathScene {
  readonly backend: FakeGpuBackend;
  readonly renderer: SceneRenderer;
  readonly document: FakeSceneDocument;
  readonly reports: PathFrameReport[];
  /** Enqueues the document's changes and draws a frame. */
  readonly frame: (camera?: Camera) => void;
  /** The meshes' bytes as the memory ledger reports them after the last frame. */
  readonly meshBytes: () => number;
}

/** Options of {@link createPathScene}. */
export interface PathSceneOptions extends Omit<PathPassOptions, 'meshBuilder'> {
  /** Builds meshes; default inline. */
  readonly meshBuilder?: PathPassOptions['meshBuilder'];
  /** Passes drawn before the path pass. */
  readonly passesBefore?: readonly ScenePass[];
  /** The culler; default the renderer's own. */
  readonly culler?: SceneCuller;
}

/**
 * Builds a renderer with a path pass named `path`.
 *
 * @param options - The pass's options, extra passes and the culler.
 * @returns The bench.
 */
export function createPathScene(options: PathSceneOptions = {}): PathScene {
  const { passesBefore = [], culler, ...passOptions } = options;
  const reports: PathFrameReport[] = [];
  const pass = createPathPass({
    meshBuilder: INLINE_MESH_BUILDER,
    ...passOptions,
    onFrame: (report) => {
      reports.push(report);
      passOptions.onFrame?.(report);
    },
  });
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: [...passesBefore, pass],
    ...(culler ? { culler } : {}),
  });
  const document = new FakeSceneDocument();
  const ledger = new MemoryLedger();
  let lastContext: FrameContext | undefined;
  renderer.frame.insertStage('after', 'submit', {
    name: 'captureContext',
    run: (context) => {
      lastContext = context;
    },
  });
  return {
    backend,
    renderer,
    document,
    reports,
    frame: (camera = PATH_CAMERA) => {
      renderer.enqueue(document.takeChanges());
      renderer.renderFrame({ timeMs: 0, camera });
    },
    meshBytes: () => {
      if (lastContext) reportSceneMemory(lastContext, ledger);
      return ledger.bytesOf('meshes');
    },
  };
}

/**
 * A closed square path, filled and stroked.
 *
 * @param id - The object id.
 * @param index - Its place in the stack, bottom first.
 * @param fields - Fields to override.
 * @returns The path.
 */
export function squarePath(
  id: string,
  index: number,
  fields: Partial<PathObject> = {},
): PathObject {
  return pathObject(
    id,
    [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ],
    { isClosed: true, isFilled: true, strokeWidth: 2 },
    { x: 10, y: 10, z: zKeyAt(index), ...fields },
  );
}

/**
 * An open zigzag path, stroked only.
 *
 * @param id - The object id.
 * @param index - Its place in the stack, bottom first.
 * @param fields - Fields to override.
 * @returns The path.
 */
export function zigzagPath(
  id: string,
  index: number,
  fields: Partial<PathObject> = {},
): PathObject {
  return pathObject(
    id,
    [
      { x: 0, y: 0 },
      { x: 20, y: 20 },
      { x: 40, y: 0 },
    ],
    { strokeWidth: 4 },
    { x: 100, y: 10, z: zKeyAt(index), ...fields },
  );
}
