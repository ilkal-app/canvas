import type { SceneObject, ScenePass } from './scene-pass.js';

/** Writes one record from an already resolved object and returns its texture page. */
export type RecordBatch = (record: Float32Array, index: number) => number;
type BatchFactory = (target: SceneObject) => RecordBatch;
const factories = new WeakMap<
  ScenePass,
  {
    readonly create: BatchFactory;
    readonly prepare: ScenePass['prepare'];
    readonly pageOf: ScenePass['pageOf'];
  }
>();
const enabled = new WeakSet<ScenePass>();

/**
 * Registers a built-in pass's synchronous per-object record preparation.
 *
 * @param pass - Renderer-local built-in pass.
 * @param create - Resolves its immutable record inputs once for this write.
 */
export function registerRecordBatch(pass: ScenePass, create: BatchFactory): void {
  // Identity witnesses only; the original methods are never invoked unbound.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Identity witness, never invoked unbound.
  factories.set(pass, { create, prepare: pass.prepare, pageOf: pass.pageOf });
}

/**
 * Enables registered writers only in the host's standard engine environment.
 *
 * @param passes - Passes created by EngineAssembly before external extensions install.
 */
export function enableRecordBatches(passes: readonly ScenePass[]): void {
  for (const pass of passes) if (factories.has(pass)) enabled.add(pass);
}

/**
 * Resolves a writer, retaining generic semantics for custom renderers or replaced callbacks.
 *
 * @param pass - The pass receiving records.
 * @param target - Current scene object and exact placement.
 * @returns Its temporary writer, or undefined for the ordinary callback path.
 */
export function getRecordBatch(pass: ScenePass, target: SceneObject): RecordBatch | undefined {
  const factory = enabled.has(pass) ? factories.get(pass) : undefined;
  return factory?.prepare === pass.prepare && pass.pageOf === factory.pageOf
    ? factory.create(target)
    : undefined;
}
