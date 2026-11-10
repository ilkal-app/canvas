import type { InstanceBuffer } from '../scene/instance-buffer.js';
import type { ScenePass } from '../scene/scene-pass.js';

import { isPreviewMeshBuilder, type PathMeshBuilder } from './path-mesh-builder.js';

const READERS = new WeakMap<InstanceBuffer, { pass: ScenePass; read: () => boolean }>();

/**
 * Registers one built-in drawer, scoped to its renderer's unique instance buffer.
 *
 * @param pass - Exact built-in pass identity.
 * @param instances - Renderer-owned instance buffer; passes themselves can be reused.
 * @param builder - Only registered built-in mesh builders can certify their resources.
 * @param read - Current exact-mesh readiness after a successful frame.
 */
export function registerPathPreview(
  pass: ScenePass,
  instances: InstanceBuffer,
  builder: PathMeshBuilder,
  read: () => boolean,
): void {
  if (isPreviewMeshBuilder(builder)) READERS.set(instances, { pass, read });
}

/**
 * Checks exact built-in path evidence without accepting another renderer or a same-name pass.
 *
 * @param pass - Installed pass.
 * @param instances - Its renderer's instance buffer.
 * @returns Whether every drawn path used its exact current mesh.
 */
export function isPathPreviewReady(
  pass: ScenePass,
  instances: InstanceBuffer | undefined,
): boolean {
  const reader = instances === undefined ? undefined : READERS.get(instances);
  return reader?.pass === pass && reader.read();
}
