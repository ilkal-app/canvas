import type { GpuBackend, GpuDeviceLostListener } from '../gpu/gpu-backend.js';
import { COLLECT_CHANGES_STAGE } from '../scene/built-in-stages.js';
import { GridBackground } from '../scene/grid-background.js';
import { enableRecordBatches } from '../scene/record-batches.js';
import type { ScenePassEntry } from '../scene/scene-pass.js';
import { captureScenePreviewStructure } from '../scene/scene-preview-resources.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import type { StickyAuthors } from '../text/scene/sticky-author-box.js';

import type { EngineExtensions } from './engine-extensions.js';
import type { EnginePassEnvironment } from './engine-foundation.js';
import type { EngineHostOptions } from './engine-host.js';
import type { EngineOverlay } from './engine-overlay.js';
import { installRootMoveBatches } from './install-root-move-batches.js';
import type { RuntimeInk } from './runtime-view.js';
import type { SceneArrivals } from './scene-arrivals.js';

/**
 * The GPU timing label of the host's scene pass: with timestamp queries and frame statistics
 * started, `BenchmarkSample.passes.scene` is its GPU time. Without statistics the backend keeps
 * at most a few frames of uncollected timings, then stops timing, so the label costs nothing.
 */
const SCENE_TIMING_LABEL = 'scene';

/**
 * The name of the stage that applies what arrived since the last frame (`SceneArrivals`): checks
 * each change set, brings the scene's mirror of the document up to date and queues it for the
 * scene, before `collectChanges`, and shows the latest overlay model. A stage rather than work
 * on arrival, so its cost is timed with the frame's.
 */
export const APPLY_CHANGES_STAGE_NAME = 'applyChanges';

/** What an {@link EngineAssembly} is built with, the same for every backend it is built on. */
export interface EngineAssemblySetup {
  /** The clear colour. */
  readonly options: EngineHostOptions;
  /** The overlay layer and image support. */
  readonly extensions: EngineExtensions;
  /** What arrived from the page; applied by the `applyChanges` stage. */
  readonly arrivals: SceneArrivals;
  /** Whether the dot grid shows at first. */
  readonly isGridVisible: boolean;
  /** The viewer's theme and ink colours, which resolve `'ink'` (`SceneRenderer.setTheme`). */
  readonly ink: RuntimeInk;
  /** Who wrote each sticky, as the board shows it (`SceneRenderer.setStickyAuthors`). */
  readonly stickyAuthors: StickyAuthors;
  /** The scene passes, new for each assembly (`EngineFoundation.scenePasses`). */
  readonly passes: readonly ScenePassEntry[];
  /**
   * Receives what could not be applied.
   *
   * @param error - The fault.
   */
  onFault(error: Error): void;
  /** Called when this assembly's device is lost. */
  readonly onDeviceLost: GpuDeviceLostListener;
  /** Asks the host for a frame: work a pass started has landed. */
  readonly requestFrame: () => void;
  /** The rendering thread's clock, ms, for passes' work budgets. */
  readonly now: () => number;
  /** The ledger, budget and image support passes are built with. */
  readonly environment: EnginePassEnvironment;
}

/**
 * The engine's drawing side on one backend: the `SceneRenderer` with the `applyChanges` stage
 * and the overlay layer installed, watching the backend for a device loss. A lost device
 * replaces the whole assembly. On the thread that renders.
 */
export class EngineAssembly {
  /** The frame driver; its `frame` is the extension point. */
  readonly renderer: SceneRenderer;
  /** The overlay layer, if the host has one. */
  readonly overlay: EngineOverlay | undefined;
  /** The dot grid, the renderer's `draw` background. */
  readonly grid: GridBackground;
  private readonly stopWatchingDevice: () => void;

  /**
   * Builds the renderer and its layers on a backend.
   *
   * @param backend - The backend; the assembly owns it.
   * @param setup - What every assembly is built with.
   */
  constructor(
    readonly backend: GpuBackend,
    setup: EngineAssemblySetup,
  ) {
    const { options, extensions, arrivals } = setup;
    this.grid = new GridBackground(backend, { isVisible: setup.isGridVisible });
    const renderer = new SceneRenderer(backend, {
      passes: setup.passes,
      environment: {
        ...setup.environment,
        requestFrame: setup.requestFrame,
        now: setup.now,
      },
      timingLabel: SCENE_TIMING_LABEL,
      theme: setup.ink.theme,
      ...(setup.ink.inkColors === undefined ? {} : { inkColors: setup.ink.inkColors }),
      ...(setup.ink.colorTokens === undefined ? {} : { colorTokens: setup.ink.colorTokens }),
      ...(setup.ink.colorModeFallback === undefined
        ? {}
        : { colorModeFallback: setup.ink.colorModeFallback }),
      background: this.grid,
      ...(options.clearColor === undefined ? {} : { clearColor: options.clearColor }),
      ...(options.churnBudget === undefined ? {} : { churnBudget: options.churnBudget }),
    });
    renderer.frame.insertStage('before', COLLECT_CHANGES_STAGE.name, {
      name: APPLY_CHANGES_STAGE_NAME,
      run: () => {
        arrivals.apply(renderer, (error) => {
          setup.onFault(error);
        });
      },
    });
    renderer.setStickyAuthors(setup.stickyAuthors);
    enableRecordBatches(renderer.scene.passes);
    installRootMoveBatches(renderer.frame);
    captureScenePreviewStructure(renderer, renderer.frame);
    this.renderer = renderer;
    this.overlay = extensions.createOverlay?.(backend);
    this.overlay?.install(renderer.frame);
    arrivals.useOverlay(this.overlay);
    this.stopWatchingDevice = backend.onDeviceLost(setup.onDeviceLost);
  }

  /**
   * Frees the overlay, the renderer and the backend (after a loss there is nothing left to free
   * on the device, and destroying its handles is harmless).
   */
  destroy(): void {
    this.stopWatchingDevice();
    this.overlay?.destroy();
    this.grid.destroy();
    this.renderer.destroy();
    this.backend.destroy();
  }
}
