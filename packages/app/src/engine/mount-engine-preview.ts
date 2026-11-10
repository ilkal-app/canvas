import { serializeChangeSet, type Camera, type PreviewCertificate } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';
import { resizeCameraViewport } from '@canvas/tools';

import type { PageImages } from '../assets/page-images.js';
import type { CanvasBackingSize } from '../canvas/backing-store-size.js';
import { expandPreviewScene } from '../collab/instance-projection.js';
import { matchesPreviewResources } from '../collab/preview-resource-match.js';
import { inkColorsOfThemes } from '../theme/canvas-background.js';
import type { ThemeName } from '../theme/theme-tokens.js';

import { holdEngineHost } from './engine-host-lease.js';
import type { EngineHostMountOptions } from './engine-host-mount-options.js';
import { waitForSceneFrame } from './engine-preview-scene.js';
import { enqueueHostScene, readHostSceneStamp } from './host-scene-stream.js';
import { createEngineHostMount } from './mount-engine-host.js';
import type { MountedEngine, MountEngineOptions } from './mounted-engine.js';
import { startBrowserHost } from './start-browser-host.js';

/** Validated, resource-verified cached drawing data; never a document authority. */
export interface EnginePreviewOptions {
  /** Complete projected objects and ancestors, already checked against the cache certificate. */
  readonly objects: readonly BoardObject[];
  /**
   * The objects that draw (`CachedProjection.shownIds`); the rest only define shown instances
   * (ruling 9). Absent: every object.
   */
  readonly shownIds?: ReadonlySet<ObjectId>;
  /** Exact camera verified by the caller, frozen until the live replacement. */
  readonly camera: Camera;
  /** The canvas backing size corresponding to that camera. */
  readonly viewport: CanvasBackingSize;
  /** Same board image adapter the live mount will use. */
  readonly images?: PageImages;
  /** Whether the verified preview includes the dot grid. */
  readonly isGridVisible: boolean;
  /** The viewer's theme, which objects' `ink` draws in; light if absent. */
  readonly theme?: ThemeName;
}

/** An inert preview that can hand its existing canvas and host to one live document. */
export interface MountedEnginePreview {
  /** The preview frame barrier, or teardown before it; not a new fidelity certificate. */
  readonly ready: Promise<void>;
  /** Certifies up to 32 ordered frames while the caller still permits the hidden attempt. */
  verifyResources(certificate: PreviewCertificate, canContinue?: () => boolean): Promise<boolean>;
  /**
   * Constructs tools/history only now and replaces the scene before exposing the live mount.
   *
   * @param options - Hydrated live document and its ordinary mount dependencies.
   * @returns The mounted engine after its live frame, still editing-disabled until the caller
   *   applies the authenticated role. Rejects on teardown or failed handoff.
   */
  attachLive(options: MountEngineOptions): Promise<MountedEngine>;
  /**
   * Clears coverage-invalid cached pixels after a viewport change and retains the host.
   *
   * @param size - New canvas size.
   */
  resize(size: CanvasBackingSize): void;
  /** Cancels startup/handoff and releases the preview or live mount, exactly once. */
  destroy(): void;
}

/**
 * Draws a previously validated preview without a Y.Doc, history, tools or input listeners.
 * The caller must keep the canvas hidden until verifyResources succeeds; a historical
 * certificate alone does not establish that current resources still match.
 *
 * @param canvas - Canvas retained through preview and live document rendering.
 * @param preview - Validated immutable drawing data and its resource adapter.
 * @param hostOptions - Host startup dependencies, also used for the live mount.
 * @returns The cancellable preview and its one-shot live handoff.
 */
export function mountEnginePreview(
  canvas: HTMLCanvasElement,
  preview: EnginePreviewOptions,
  hostOptions: EngineHostMountOptions,
): MountedEnginePreview {
  return new EnginePreview(canvas, preview, hostOptions);
}

class EnginePreview implements MountedEnginePreview {
  readonly ready: Promise<void>;
  private camera: Camera;
  private viewport: CanvasBackingSize;
  private objectIds: readonly ObjectId[];
  private readonly hold: ReturnType<typeof holdEngineHost>;
  private readonly cancelled: Promise<void>;
  // Set in the constructor by the `cancelled` promise's executor, which runs at once.
  private cancel!: () => void;
  private isDestroyed = false;
  private didAttach = false;
  private didInvalidate = false;
  private live: MountedEngine | undefined;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly preview: EnginePreviewOptions,
    private readonly hostOptions: EngineHostMountOptions,
  ) {
    this.camera = { ...preview.camera };
    this.viewport = preview.viewport;
    const objects = new Map(preview.objects.map((object) => [object.id, object]));
    // Instances draw as the live feed draws them: expanded over the restored definitions, with
    // their virtual ids in the scene (never stored), retired mains hidden (ruling 9).
    const scene = preview.objects.some((object) => object.type === 'instance')
      ? expandPreviewScene(preview.objects, preview.shownIds)
      : undefined;
    this.objectIds = scene?.created ?? [...objects.keys()];
    const start =
      hostOptions.startHost ??
      ((target, prefer) => startBrowserHost(target, prefer, hostOptions, preview.images));
    this.hold = holdEngineHost(canvas, () => start(canvas, hostOptions.prefer));
    this.cancelled = new Promise<void>((resolve) => {
      this.cancel = resolve;
    });
    this.ready = Promise.race([
      this.hold.host.then(async (host) => {
        if (this.isDestroyed) return;
        const { widthPx, heightPx, dpr } = this.viewport;
        host.resize(widthPx, heightPx, dpr);
        enqueueHostScene(
          host,
          serializeChangeSet(
            scene ?? {
              created: this.objectIds,
              updated: [],
              deleted: [],
              get: (id) => objects.get(id),
            },
          ),
        );
        host.setGridVisible(preview.isGridVisible);
        host.setTheme(preview.theme ?? 'light', inkColorsOfThemes());
        host.setCamera(this.camera);
        try {
          await waitForSceneFrame(host, () => this.camera);
        } catch (error) {
          if (!this.didInvalidate) throw error;
        }
      }),
      this.cancelled,
    ]);
  }

  async verifyResources(
    certificate: PreviewCertificate,
    canContinue: () => boolean = () => true,
  ): Promise<boolean> {
    await this.ready;
    if (!this.canVerify() || !canContinue()) return false;
    const host = await this.hold.host;
    const scene = readHostSceneStamp(host);
    if (scene === undefined || host.readPreviewCertificate === undefined) return false;
    // Each request acknowledges another drawn frame. Initial font/glyph jobs can outlive
    // the first scene acknowledgement; absent evidence is never accepted as readiness.
    for (let attempt = 0; attempt < 32; attempt += 1) {
      if (!this.canVerify() || !canContinue()) return false;
      const fresh = await host.readPreviewCertificate({
        scene,
        camera: this.camera,
        coverage: certificate.coverage,
        fontSetKey: certificate.fontSetKey,
      });
      const current = readHostSceneStamp(host);
      if (
        !this.canVerify() ||
        !canContinue() ||
        current?.session !== scene.session ||
        current.sequence !== scene.sequence
      )
        return false;
      if (fresh !== undefined)
        return (
          fresh.scene.session === scene.session &&
          fresh.scene.sequence === scene.sequence &&
          matchesPreviewResources(certificate, fresh)
        );
    }
    return false;
  }

  async attachLive(options: MountEngineOptions): Promise<MountedEngine> {
    if (this.didAttach || this.isDestroyed)
      throw new Error('The preview cannot attach another document.');
    this.didAttach = true;
    try {
      // A rejected optional frame is not a verdict on the hydrated scene. Keep the lease:
      // a transferred canvas cannot start another worker. The live replacement below must
      // independently acknowledge its own scene before exposing input or pixels.
      await this.ready.catch(() => undefined);
      this.assertActive();
      this.live = createEngineHostMount({
        ...this.hostOptions,
        previewScene: {
          camera: this.camera,
          objectIds: this.objectIds,
          isGridVisible: this.preview.isGridVisible,
        },
      })(this.canvas, { ...options, viewport: this.viewport });
      this.live.setEditable(false);
      await Promise.race([this.live.ready, this.cancelled]);
      this.assertActive();
      return this.live;
    } catch (error) {
      this.live?.destroy();
      throw error;
    } finally {
      this.hold.release();
    }
  }

  resize(size: CanvasBackingSize): void {
    if (this.isDestroyed) return;
    if (this.live !== undefined) {
      this.live.resize(size);
      return;
    }
    if (
      Object.entries(size).every(
        ([key, value]) => this.viewport[key as keyof CanvasBackingSize] === value,
      )
    )
      return;
    this.viewport = size;
    this.camera = resizeCameraViewport(this.camera, size);
    this.didInvalidate = true;
    const deleted = this.objectIds;
    this.objectIds = [];
    void this.hold.host.then(
      (host) => {
        if (this.isDestroyed || this.live !== undefined) return;
        enqueueHostScene(host, { created: [], updated: [], deleted, objects: {} });
        host.resize(size.widthPx, size.heightPx, size.dpr);
        host.setCamera(this.camera);
      },
      () => undefined,
    );
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.cancel();
    this.live?.destroy();
    this.hold.release();
  }

  private canVerify(): boolean {
    return !this.isDestroyed && !this.didAttach && !this.didInvalidate;
  }

  private assertActive(): void {
    if (this.isDestroyed) throw new Error('The preview was unmounted.');
  }
}
