import type { WorkerTransportFactory } from '../workers/worker-transport.js';

/**
 * The job workers an engine host's pool starts (path flattening, mesh building and other
 * expensive work run there): code, so the app's scripts supply it, the engine worker's
 * through `createEngineWorkerEntry`'s extensions and the page's through `createEngineHost`. The
 * app owns the bundler and so the job worker's URL; its script is
 * `serveWorkerEntry(self, createWorkerEntry(createProductionJobHandlers()))`.
 */
export interface EngineJobWorkers {
  /** How many to start (`chooseWorkerCount(detectWorkerEnvironment(self))`); 0 for none. */
  readonly count: number;
  /** Starts one: `() => createWebWorkerTransport(new Worker(url, { type: 'module' }))`. */
  readonly spawn: WorkerTransportFactory;
}
