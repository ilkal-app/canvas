import {
  chooseWorkerCount,
  createWebWorkerTransport,
  detectWorkerEnvironment,
  type EngineJobWorkers,
  type WorkerHost,
} from '@canvas/engine';

/**
 * The engine's job workers for the thread that runs the engine: as many as
 * `chooseWorkerCount` allows there (none where the thread cannot start workers), each a module
 * worker running `job-worker.ts`. The app owns the bundler, so it owns the worker's URL; Vite
 * turns the `new URL(…, import.meta.url)` into the bundled script, in the page's bundle and in
 * the engine worker's.
 *
 * @param scope - The thread's global: the page's `window` or the engine worker's `self`.
 * @returns The job workers, for `createEngineHost` or `createEngineWorkerEntry`.
 */
export function engineJobWorkers(scope: WorkerHost): EngineJobWorkers {
  return {
    count: chooseWorkerCount(detectWorkerEnvironment(scope)),
    // Written inline so Vite recognises the pattern and bundles the worker script.
    spawn: () =>
      createWebWorkerTransport(
        new Worker(new URL('./job-worker.ts', import.meta.url), { type: 'module' }),
      ),
  };
}
