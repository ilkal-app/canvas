import type { Camera } from '../camera/camera.js';
import type { WorldTransform } from '../scene/world-transform.js';

import type { ImageBinding } from './image-binding.js';
import type { ObjectPlan } from './image-needs.js';
import type { ResidencyImage } from './residency-image.js';

/** One exact resident allocation on this renderer, not a reusable GPU handle. */
export interface ImageResidentEvidence {
  /** Immutable resident resource key. */
  readonly key: string;
  /** Renderer-local allocation identity. */
  readonly identity: number;
  /** Resident width in pixels. */
  readonly widthPx: number;
  /** Resident height in pixels. */
  readonly heightPx: number;
}

/** An image's target plan and actual binding at the completed image stage. */
export interface ImageObjectEvidence {
  /** Immutable image (an image object, or an image paint's) used by this frame. */
  readonly object: ResidencyImage;
  /** World placement used by this frame. */
  readonly transform: WorldTransform;
  /** Verified immutable image content identity. */
  readonly contentIdentity: string;
  /** Exact level and tile decisions. */
  readonly plan: ObjectPlan;
  /** Actual sampled texture regions. */
  readonly binding: ImageBinding;
  /** Allocations backing the sampled regions. */
  readonly residents: readonly ImageResidentEvidence[];
}

/** Frame evidence only; caller still owes a successful full-frame/scene barrier. */
export interface ImagePreviewEvidence {
  /** Successful frame index. */
  readonly frameIndex: number;
  /** Renderer generation for the completed frame. */
  readonly frameGeneration: number;
  /** Camera used by the completed frame. */
  readonly camera: Camera;
  /** Image contributors captured after the image stage. */
  readonly images: readonly ImageObjectEvidence[];
}
