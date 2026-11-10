import type { FrameContext } from '../scene/frame-context.js';

import type { MemoryLedger } from './memory-ledger.js';

/** The ledger owner name of the camera uniform buffer. */
export const CAMERA_UNIFORM_OWNER = 'camera';

/** The ledger owner name of the scene's clip table texture, under `textures`. */
export const CLIP_TABLE_OWNER = 'clip-table';

/**
 * Reports the scene's GPU memory to a ledger: each pass's GPU instance
 * buffer under `instanceBuffers`, named by pass, what a custom-draw pass's drawer holds under
 * its own category (the path pass's meshes under `meshes`), what each pass reports of its own
 * (`ScenePass.reportMemory`: the text pass's glyph atlas under `atlases`), the camera uniform
 * under `uniforms`, and the clip table's texture under `textures`, owner
 * {@link CLIP_TABLE_OWNER}, its allocated size, so the textures budget counts it. The GPU instance buffer has the CPU buffer's size (`ScenePassResources`
 * keeps them in step), so `InstanceBuffer.byteLength` is its size. The scene stays free of diagnostics: the stage timers
 * call this at the end of every frame, which catches a buffer that grew during it. Allocates
 * nothing once every pass has an entry.
 *
 * @param context - The frame's passes and camera uniform.
 * @param ledger - The ledger to report to.
 */
export function reportSceneMemory(
  context: Pick<FrameContext, 'passes' | 'cameraUniform' | 'clipTable'>,
  ledger: MemoryLedger,
): void {
  for (const { pass, instances, drawer } of context.passes) {
    ledger.set('instanceBuffers', pass.name, instances.byteLength);
    if (drawer) {
      const { category, bytes } = drawer.memory();
      ledger.set(category, pass.name, bytes);
    }
    pass.reportMemory?.(ledger);
  }
  ledger.set('uniforms', CAMERA_UNIFORM_OWNER, context.cameraUniform.buffer.byteLength);
  if (context.clipTable) ledger.set('textures', CLIP_TABLE_OWNER, context.clipTable.byteLength);
}
