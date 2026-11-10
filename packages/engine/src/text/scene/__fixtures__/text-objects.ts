// Text objects and a renderer with the text pass for the text pass's tests: the bundled
// Liberation Sans faces, a worker pool with no workers (its jobs run when a frame drains it), the
// fake GPU backend, and a helper that renders frames until glyphs have landed.
import type { ObjectId, PrincipalId, TextObject, TextStyle } from '@canvas/schema';

import type { Camera } from '../../../camera/camera.js';
import { FakeGpuBackend } from '../../../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument } from '../../../scene/__fixtures__/scene-objects.js';
import { SceneRenderer, type SceneRendererOptions } from '../../../scene/scene-renderer.js';
import { createDefaultJobHandlers } from '../../../workers/default-job-handlers.js';
import { WorkerPool } from '../../../workers/worker-pool.js';
import { BUNDLED_FAMILY, loadBundledFaces } from '../../__fixtures__/bundled-fonts.js';
import { FontLibrary } from '../../font/font-library.js';
import { preloadLayoutShaper } from '../../layout/layout-job.js';
import type { TextPassResources } from '../text-pass-resources.js';
import { TEXT_PASS, TEXT_PASS_NAME } from '../text-pass.js';

/** The bundled family at 20 world px, black. */
export const STYLE: TextStyle = {
  fontFamily: BUNDLED_FAMILY,
  fontSize: 20,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

/** A camera at the origin, 100%, over 400 × 300 CSS px. */
export const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 400,
  viewportHeightPx: 300,
  dpr: 1,
};

/**
 * An auto-width text object at the origin in one run.
 *
 * @param id - The id.
 * @param text - The characters.
 * @param overrides - Fields to change; a parent id may be given as a plain string.
 * @returns The object.
 */
export function textObject(
  id: string,
  text: string,
  overrides: Partial<Omit<TextObject, 'id' | 'type' | 'parentId'>> & {
    readonly parentId?: string | null;
  } = {},
): TextObject {
  const { parentId = null, ...fields } = overrides;
  return {
    id: id as ObjectId,
    type: 'text',
    parentId: parentId as ObjectId | null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:fixture' as PrincipalId,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    width: 100,
    height: 25,
    text,
    runs: [{ length: text.length, style: STYLE }],
    align: 'left',
    autoWidth: true,
    verticalAlign: 'top',
    ...fields,
  };
}

/** A renderer drawing the text pass alone, and what it runs on. */
export interface TextSetUp {
  readonly backend: FakeGpuBackend;
  readonly renderer: SceneRenderer;
  readonly document: FakeSceneDocument;
  readonly pool: WorkerPool;
  /** The font library the pass lays out with; empty when the set-up was made without fonts. */
  readonly fonts: FontLibrary;
  readonly frameRequests: { count: number };
  /**
   * Renders frames, letting jobs and their replies run between them, until the text pass has
   * no layout or glyph work left, or `maxFrames` (default 12); resolves with the frame count.
   * Frames render with the set-up's camera unless another is given.
   */
  readonly settle: (maxFrames?: number, camera?: Camera) => Promise<number>;
  /** The text pass's instance records, `floatsPerRecord` floats each, up to its record count. */
  readonly records: () => Float32Array[];
}

/**
 * Adds the bundled faces to a font library.
 *
 * @param fonts - The library.
 */
export function addBundledFaces(fonts: FontLibrary): void {
  for (const { face, bytes } of loadBundledFaces()) fonts.addFace(face, bytes);
}

/**
 * Creates a renderer with the text pass over the bundled faces.
 *
 * @param camera - The camera frames render with.
 * @param hasFonts - Whether the faces are loaded at the start (else a test adds them).
 * @param isZOrdered - Whether the renderer draws in z-order segments (which leave out hidden
 *   text); default false.
 * @param options - Additional renderer options for bounds and pass integration tests.
 * @param text - Text pass settings beside the faces and the pool (a rewrite budget, say).
 * @returns The set-up.
 */
export function createTextSetUp(
  camera: Camera = CAMERA,
  hasFonts = true,
  isZOrdered = false,
  options: SceneRendererOptions = {},
  text: Omit<TextPassResources, 'fonts' | 'jobs'> = {},
): TextSetUp {
  const fonts = new FontLibrary();
  if (hasFonts) addBundledFaces(fonts);
  const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: createDefaultJobHandlers() });
  const backend = new FakeGpuBackend();
  const frameRequests = { count: 0 };
  let timeMs = 0;
  const renderer = new SceneRenderer(backend, {
    passes: [TEXT_PASS],
    environment: {
      requestFrame: () => {
        frameRequests.count += 1;
      },
      now: () => timeMs,
      text: { ...text, fonts, jobs: pool },
    },
    isZOrdered,
    ...options,
  });
  const document = new FakeSceneDocument();
  const settle = async (maxFrames = 12, frameCamera = camera): Promise<number> => {
    // Layouts are shaped: the cache asks for none until the shaper has loaded, so a
    // warm engine's, loaded once per thread, is what these frames draw with.
    await preloadLayoutShaper();
    for (let frame = 1; frame <= maxFrames; frame += 1) {
      frameRequests.count = 0;
      renderer.renderFrame({ timeMs, camera: frameCamera });
      // The pass only submits; the pool's owner runs its queue after the frame, as the runtime does.
      pool.drainMainThread(1_000, () => timeMs);
      timeMs += 16;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (frameRequests.count === 0) return frame;
    }
    return maxFrames;
  };
  const records = (): Float32Array[] => {
    const buffer = renderer.scene.instanceBufferOf(TEXT_PASS_NAME);
    const floats = buffer.layout.floatsPerRecord;
    return Array.from({ length: buffer.recordCount }, (ignored, slot) =>
      buffer.data.slice(slot * floats, (slot + 1) * floats),
    );
  };
  return { backend, renderer, document, pool, fonts, frameRequests, settle, records };
}
