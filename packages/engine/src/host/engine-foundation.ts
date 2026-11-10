import type { MemoryLedger } from '../diagnostics/memory-ledger.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';
import { createImagePassSupport } from '../images/image-pass-support.js';
import type { ImageJobRunner } from '../images/level-loader.js';
import type { TextureManager } from '../images/texture-manager.js';
import { AtlasLoan } from '../memory/atlas-loan.js';
import { budgetForDevice, type DeviceMemoryBudget } from '../memory/device-budget.js';
import type { ScenePassEntry, ScenePassEnvironment } from '../scene/scene-pass.js';

import type { EngineExtensions, EngineImageSupport } from './engine-extensions.js';
import type { EngineHostOptions } from './engine-host.js';
import { EngineJobs } from './engine-jobs.js';

/** What an engine's passes are built with besides the backend and the frame hooks. */
export type EnginePassEnvironment = Pick<
  ScenePassEnvironment,
  'ledger' | 'images' | 'text' | 'atlasLoan'
> & {
  /** The device's GPU memory budget, which every cache draws its share from. */
  readonly budget: DeviceMemoryBudget;
};

/**
 * The device's budget for a backend (`budgetForDevice`): the device the page described, and the
 * backend's texture limit.
 *
 * @param backend - The backend.
 * @param options - The device description.
 * @returns The budget.
 */
function budgetFor(backend: GpuBackend, options: EngineHostOptions): DeviceMemoryBudget {
  return budgetForDevice({
    deviceMemoryGb: options.device?.deviceMemoryGb,
    maxTextureSize: backend.capabilities.maxTextureSize,
    isMobile: options.device?.isMobile ?? false,
  });
}

/**
 * A budget's loan of unused texture memory to the scene text atlas.
 *
 * @param budget - The device's budget.
 * @returns A loan from its textures, nothing borrowed yet.
 */
function loanFor(budget: DeviceMemoryBudget): AtlasLoan {
  return new AtlasLoan({ texturesBytes: budget.bytesByCategory.textures });
}

/**
 * The ledger, budget and image support of an engine's passes: the budget
 * for the device the page described, the image catalogue over the host's assets.
 *
 * @param backend - The first backend: its texture limit.
 * @param options - The device description.
 * @param extensions - The image assets, if any.
 * @param ledger - The engine's ledger.
 * @param jobs - The engine's job pool, where images are decoded.
 * @param onFault - The engine's fault channel, told once when no job worker can decode images.
 * @returns The environment.
 */
export function passEnvironmentOf(
  backend: GpuBackend,
  options: EngineHostOptions,
  extensions: EngineExtensions,
  ledger: MemoryLedger,
  jobs: ImageJobRunner,
  onFault?: (error: Error) => void,
): EnginePassEnvironment {
  const { maxTextureSize } = backend.capabilities;
  const budget = budgetFor(backend, options);
  const atlasLoan = loanFor(budget);
  const { images } = extensions;
  return images === undefined
    ? { ledger, budget, atlasLoan }
    : {
        ledger,
        budget,
        atlasLoan,
        images: createImagePassSupport(
          images.assets,
          // Only EngineJobs.runQueued drains this shared pool, after the frame.
          {
            submit: jobs.submit.bind(jobs),
            cancel: jobs.cancel.bind(jobs),
            setPriority: jobs.setPriority.bind(jobs),
          },
          maxTextureSize,
          onFault,
        ),
      };
}

/**
 * What an engine runtime keeps across a lost device: its job pool (no GPU
 * resources) and what its passes are built with, above all the device's memory budget, which
 * the texture manager and the path mesh cache share. Each `EngineAssembly` builds its passes
 * from it. On the thread that renders.
 */
export class EngineFoundation {
  /** The job pool meshes and images are made in: the job workers, or this thread's queue. */
  readonly jobs: EngineJobs;
  /**
   * The ledger, budget, image support and text resources passes are built with; the budget
   * follows the backend.
   */
  environment: EnginePassEnvironment;
  /** The image support given, closed with the foundation. */
  private readonly images: EngineImageSupport | undefined;
  /** The image pass's texture manager, once it has built one. */
  private textureManager: TextureManager | undefined;

  /**
   * Starts the job pool and works out the budget.
   *
   * @param backend - The first backend: its texture limit.
   * @param options - The device description.
   * @param extensions - The job workers, image support and text resources, if any.
   * @param ledger - The engine's ledger.
   * @param onFault - The engine's fault channel, told once when no job worker can decode images.
   */
  constructor(
    backend: GpuBackend,
    private readonly options: EngineHostOptions,
    extensions: EngineExtensions,
    ledger: MemoryLedger,
    onFault?: (error: Error) => void,
  ) {
    this.images = extensions.images;
    const decode = extensions.images?.decodeFallback;
    this.jobs = new EngineJobs(extensions.jobWorkers, decode === undefined ? {} : { decode });
    const { pool } = this.jobs;
    const passEnvironment = passEnvironmentOf(backend, options, extensions, ledger, pool, onFault);
    const { images } = passEnvironment;
    const environment =
      images === undefined
        ? passEnvironment
        : {
            ...passEnvironment,
            images: {
              ...images,
              onManager: (manager: TextureManager) => {
                this.textureManager = manager;
                images.onManager?.(manager);
              },
            },
          };
    const { createTextResources } = extensions;
    // The fonts outlive a lost device too: every assembly's text pass shares them and the pool.
    this.environment =
      createTextResources === undefined
        ? environment
        : {
            ...environment,
            text: {
              fonts: createTextResources(options.fontFaces ?? []),
              jobs: this.jobs.submitter,
              hasVectorGlyphs: options.hasVectorGlyphs ?? true,
            },
          };
  }

  /**
   * Whether no image level is being fetched, decoded or waiting to upload: the texture manager's
   * `isIdle`, or true before the image pass has built one.
   *
   * @returns Whether images are idle.
   */
  get isImageIdle(): boolean {
    return this.textureManager?.isIdle ?? true;
  }

  /**
   * Follows a backend rebuilt after a lost device: the budget and the
   * image catalogue's levels are worked out again for its texture limit, which may differ.
   *
   * @param backend - The new backend.
   */
  adoptBackend(backend: GpuBackend): void {
    const budget = budgetFor(backend, this.options);
    this.environment = { ...this.environment, budget, atlasLoan: loanFor(budget) };
    this.environment.images?.catalogue.setMaxTextureSize(backend.capabilities.maxTextureSize);
  }

  /**
   * A new set of the standard scene passes over the pool, under the budget.
   *
   * @param onFault - Receives mesh builds that failed or timed out, after the frame.
   * @returns The passes.
   */
  scenePasses(onFault: (error: Error) => void): ScenePassEntry[] {
    return this.jobs.scenePasses(this.environment.budget, onFault);
  }

  /**
   * Stops the job workers, stops following the assets and closes the image support: the runtime
   * is destroyed.
   */
  destroy(): void {
    this.jobs.terminate();
    this.environment.images?.catalogue.destroy();
    this.images?.close?.();
  }
}
