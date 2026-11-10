import { visibleWorldBounds, type Camera } from '../camera/camera.js';
import { imagePreviewKey } from '../images/image-preview-key.js';
import type { SceneRenderer } from '../scene/scene-renderer.js';

import { toError } from './frame-reads.js';
import {
  copyPreviewRequest,
  isPreviewRequest,
  isPreviewCertificate,
  type PreviewCertificate,
  type PreviewRequest,
} from './scene-certificate.js';
import { SceneRevisions } from './scene-revisions.js';

interface PendingPreview {
  readonly request: PreviewRequest;
  readonly resolve: (value: PreviewCertificate | undefined) => void;
  readonly reject: (error: Error) => void;
}

/** Frame reads gated by exact applied scene identity and every built-in resource contributor. */
export class PreviewReads {
  /** Applied stream tracker; invalidation never changes ordinary rendering. */
  readonly revisions = new SceneRevisions();
  private readonly pending: PendingPreview[] = [];

  /**
   * Owns a validated request until the next successful frame.
   *
   * @param request - The requested scene, camera and resource identities.
   * @returns Complete certificate or undefined when any contributor refuses.
   */
  read(request: PreviewRequest): Promise<PreviewCertificate | undefined> {
    if (!isPreviewRequest(request))
      return Promise.reject(new RangeError('Invalid preview request.'));
    const owned = copyPreviewRequest(request);
    return new Promise((resolve, reject) => this.pending.push({ request: owned, resolve, reject }));
  }

  /**
   * Checks the scene/camera portion only, never resource readiness.
   *
   * @param request - Expected frame identity.
   * @param camera - The actual drawn camera.
   * @param hasPendingChanges - Whether newer runtime arrivals remain queued.
   * @returns Whether this frame could be considered by resource contributors.
   */
  matchesFrame(
    request: PreviewRequest,
    camera: Camera | undefined,
    hasPendingChanges: boolean,
  ): boolean {
    const expected = request.camera;
    const viewport = visibleWorldBounds(expected);
    const coverage = request.coverage;
    return (
      coverage.minX <= viewport.minX &&
      coverage.minY <= viewport.minY &&
      coverage.maxX >= viewport.maxX &&
      coverage.maxY >= viewport.maxY &&
      !hasPendingChanges &&
      this.revisions.matches(request.scene) &&
      camera?.x === expected.x &&
      camera.y === expected.y &&
      camera.zoom === expected.zoom &&
      camera.dpr === expected.dpr &&
      camera.viewportWidthPx === expected.viewportWidthPx &&
      camera.viewportHeightPx === expected.viewportHeightPx
    );
  }

  /**
   * Settles reads after a successful draw, rechecking live state after resource callbacks.
   *
   * @param renderer - Renderer after its draw.
   * @param camera - Actual drawn camera.
   * @param hasPendingChanges - Live runtime fence for arrivals, camera revision and teardown.
   */
  answer(
    renderer: SceneRenderer,
    camera: Camera | undefined,
    hasPendingChanges: boolean | (() => boolean),
  ): void {
    const isPending =
      typeof hasPendingChanges === 'function' ? hasPendingChanges : () => hasPendingChanges;
    for (const read of this.pending.splice(0)) {
      try {
        let certificate: PreviewCertificate | undefined;
        if (this.matchesFrame(read.request, camera, isPending())) {
          const candidates = renderer.projectionCandidates(read.request.coverage);
          const resources =
            camera === undefined
              ? undefined
              : renderer.readPreviewResources(camera, read.request.fontSetKey, candidates);
          if (candidates !== undefined && resources !== undefined) {
            const images = resources.images.flatMap((image) => image.images);
            const imagePlanKey = imagePreviewKey(images);
            const assets = new Map<string, string>();
            let hasConflict = false;
            for (const image of images) {
              const previous = assets.get(image.object.assetId);
              if (previous !== undefined && previous !== image.contentIdentity) hasConflict = true;
              assets.set(image.object.assetId, image.contentIdentity);
            }
            if (
              !hasConflict &&
              imagePlanKey !== undefined &&
              resources.isCurrent() &&
              this.matchesFrame(read.request, camera, isPending())
            ) {
              const proposed = {
                ...read.request,
                candidates: [...candidates],
                assets: [...assets].map(([assetId, contentVersion]) => ({
                  assetId,
                  contentVersion,
                })),
                imagePlanKey,
                lodPlanKey: resources.lodPlanKey,
                frameIndex: resources.frameIndex,
                resourceGeneration: resources.frameIndex,
              };
              if (isPreviewCertificate(proposed)) certificate = proposed;
            }
          }
        }
        read.resolve(certificate);
      } catch (error) {
        read.reject(toError(error));
      }
    }
  }

  /**
   * Rejects all reads and permanently invalidates the stream after destruction or a frame fault.
   *
   * @param error - Failure that ended this frame or mount.
   */
  reject(error: Error): void {
    this.revisions.invalidate();
    for (const read of this.pending.splice(0)) read.reject(error);
  }
}
