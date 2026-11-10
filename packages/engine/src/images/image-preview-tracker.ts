import type { AssetId } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';

import type { AssetCatalogue } from './asset-catalogue.js';
import { bindImage, imageRecordCount } from './bind-image.js';
import type { BindingTable } from './binding-table.js';
import { isSameBinding } from './image-binding.js';
import { assetOfKey, type ImageCandidate, type ObjectPlan } from './image-needs.js';
import type { ImagePlanner } from './image-planner.js';
import type { ImageObjectEvidence, ImagePreviewEvidence } from './image-preview-evidence.js';
import type { LevelSource } from './level-loader.js';
import type { ResidentLevel, TextureResidency } from './texture-residency.js';

/** Manager-owned dependencies; no mutation or load is performed while collecting evidence. */
export interface ImagePreviewState {
  readonly catalogue: AssetCatalogue;
  readonly planner: ImagePlanner;
  readonly table: BindingTable;
  readonly residency: TextureResidency;
  readonly candidates: () => readonly ImageCandidate[];
  readonly isReady: () => boolean;
  readonly isPending: (key: string) => boolean;
  readonly isQueued: (key: string) => boolean;
}
interface Provenance {
  readonly identity: string;
  readonly source: string;
}

/** Strong provenance entries retained for current assets and in-flight work. */
export interface ImageProvenanceCounts {
  /** Assets still used by tracked image objects. */
  readonly assets: number;
  /** Requests whose current loader generation has not completed or been cancelled. */
  readonly requests: number;
  /** Decoded results still awaiting upload or queue pruning. */
  readonly decoded: number;
}

/** Conservative image proof scoped to one renderer; source changes permanently refuse it. */
export class ImagePreviewTracker {
  private readonly identities = new Map<AssetId, string | undefined>();
  private readonly requests = new Map<string, { source: LevelSource; proof: Provenance }>();
  private readonly decoded = new Map<string, Provenance>();
  private readonly residents = new WeakMap<ResidentLevel, Provenance>();
  private readonly residentIds = new WeakMap<ResidentLevel, number>();
  private readonly issued = new WeakMap<ImagePreviewEvidence, string>();
  private nextResidentId = 0;
  private isInvalid = false;
  private frame: { camera: Camera; frameIndex: number; frameGeneration: number } | undefined;

  /**
   * Creates the renderer-local tracker.
   *
   * @param state - Live manager resources.
   */
  constructor(private readonly state: ImagePreviewState) {}

  /**
   * Anchors trusted identity before any new load. Cached copies without provenance refuse.
   *
   * @param assetId - The tracked asset.
   */
  observe(assetId: AssetId): void {
    if (!this.isEnabled()) return;
    let identity: string | undefined;
    try {
      identity = this.state.catalogue.assets.immutableContentIdentity?.(assetId);
    } catch {
      this.invalidate();
      return;
    }
    if (!this.isEnabled()) return;
    if (identity === undefined || identity === '') {
      if (this.identities.has(assetId)) this.invalidate();
      return;
    }
    if (!this.identities.has(assetId)) {
      this.identities.set(assetId, identity);
      if (this.state.catalogue.peek(assetId)?.smallest !== undefined) this.invalidate();
    }
    if (this.identities.get(assetId) !== identity) this.invalidate();
  }

  /**
   * Records trusted provenance at request admission, not at eventual completion.
   *
   * @param key - Level/tile key.
   * @param source - Exact source selected by the planner.
   * @returns A unique proven source object for this generation; unchanged input if proof is disabled.
   */
  admit(key: string, source: LevelSource): LevelSource {
    this.observe(source.assetId);
    if (this.isInvalid) return source;
    const identity = this.identities.get(source.assetId);
    if (identity === undefined) {
      this.invalidate();
      return source;
    }
    const admitted = structuredClone(source);
    if (!this.isEnabled()) return source;
    this.requests.set(key, {
      source: admitted,
      proof: { identity, source: JSON.stringify(admitted) },
    });
    return admitted;
  }

  /**
   * Accepts only the admitted source; late differently sourced results invalidate evidence.
   *
   * @param key - Level/tile key.
   * @param source - Source carried by the actual completion.
   */
  loaded(key: string, source: LevelSource): void {
    if (!this.isEnabled()) return;
    this.observe(source.assetId);
    if (!this.isEnabled()) return;
    const request = this.requests.get(key);
    this.requests.delete(key);
    if (request?.source !== source || request.proof.source !== JSON.stringify(source))
      this.invalidate();
    else if (!this.isInvalid) this.decoded.set(key, request.proof);
  }

  /**
   * Associates a successful upload with its exact resident object, including in-place reuse.
   *
   * @param key - Uploaded key.
   */
  uploaded(key: string): void {
    if (!this.isEnabled()) return;
    const resident = this.state.residency.get(key);
    const proof = this.decoded.get(key);
    this.decoded.delete(key);
    if (resident !== undefined && proof !== undefined) this.residents.set(resident, proof);
  }

  /** Permanently refuses evidence after an upload failure or destruction. */
  invalidate(): void {
    this.isInvalid = true;
    this.identities.clear();
    this.requests.clear();
    this.decoded.clear();
  }

  /**
   * Releases only a cancelled request; live resident proofs use weak ownership.
   *
   * @param key - Cancelled loader key.
   */
  cancel(key: string): void {
    this.requests.delete(key);
  }

  /**
   * Drops strong provenance when the last object using an asset is removed.
   *
   * @param assetId - No longer tracked asset.
   */
  forget(assetId: AssetId): void {
    this.identities.delete(assetId);
    for (const key of this.requests.keys())
      if (assetOfKey(key) === assetId) this.requests.delete(key);
    for (const key of this.decoded.keys())
      if (assetOfKey(key) === assetId) this.decoded.delete(key);
  }

  /**
   * Strong entries only; resident/issued evidence is weakly owned.
   *
   * @returns Counts for bounded-lifecycle diagnostics.
   */
  retainedCounts(): ImageProvenanceCounts {
    return {
      assets: this.identities.size,
      requests: this.requests.size,
      decoded: this.decoded.size,
    };
  }

  /**
   * Records the image stage after binding records were rewritten; full-frame barrier is external.
   *
   * @param camera - The actual frame camera.
   * @param frameIndex - Its frame index.
   */
  finish(camera: Camera, frameIndex: number): void {
    for (const key of this.requests.keys())
      if (!this.state.isPending(key)) this.requests.delete(key);
    for (const key of this.decoded.keys()) if (!this.state.isQueued(key)) this.decoded.delete(key);
    this.frame = {
      camera: { ...camera },
      frameIndex,
      frameGeneration: (this.frame?.frameGeneration ?? 0) + 1,
    };
  }

  /**
   * Collects exact visible target plans/residency; placeholders and lower-resolution fallback refuse.
   *
   * @returns Owned evidence, or undefined for any missing dependency.
   */
  read(): ImagePreviewEvidence | undefined {
    const evidence = this.collect();
    if (evidence !== undefined) this.issued.set(evidence, JSON.stringify(evidence));
    return evidence;
  }

  /**
   * Rechecks both caller-owned evidence and current manager state without trusting caller edits.
   *
   * @param evidence - A result issued by this tracker.
   * @returns Whether exact frame, objects, bindings and resident identities still match.
   */
  isCurrent(evidence: ImagePreviewEvidence): boolean {
    const saved = this.issued.get(evidence);
    return (
      saved !== undefined &&
      JSON.stringify(evidence) === saved &&
      JSON.stringify(this.collect()) === saved
    );
  }

  private isEnabled(): boolean {
    return !this.isInvalid;
  }

  private canRead(): boolean {
    return !this.isInvalid && this.state.isReady();
  }

  private collect(): ImagePreviewEvidence | undefined {
    const frame = this.frame;
    if (frame === undefined || this.isInvalid || !this.state.isReady()) return undefined;
    const images: ImageObjectEvidence[] = [];
    for (const candidate of this.state.candidates()) {
      if (candidate.priority !== 'visible') continue;
      const evidence = this.objectEvidence(candidate);
      if (evidence === undefined) return undefined;
      images.push(evidence);
    }
    if (!this.canRead() || frame !== this.frame) return undefined;
    return structuredClone({ ...frame, images });
  }

  private objectEvidence({ image }: ImageCandidate): ImageObjectEvidence | undefined {
    const { object, transform } = image;
    this.observe(object.assetId);
    const identity = this.identities.get(object.assetId);
    const { catalogue, planner, table, residency } = this.state;
    const entry = catalogue.peek(object.assetId);
    const plan = planner.planOf(object.id);
    const binding = table.all.get(object.id);
    if (
      this.isInvalid ||
      identity === undefined ||
      entry?.status !== 'described' ||
      entry.info?.naturalSize?.width !== object.naturalSize.width ||
      entry.info.naturalSize.height !== object.naturalSize.height ||
      plan === undefined ||
      binding === undefined ||
      binding.parts.some(({ source }) => source === undefined)
    )
      return undefined;
    const keys = targetKeys(plan, imageRecordCount(object));
    const residents = keys?.map((key) => residency.get(key));
    if (residents === undefined || residents.some((resident) => resident === undefined))
      return undefined;
    for (const resident of residents) {
      if (resident === undefined || !this.proves(resident, identity)) return undefined;
    }
    const exact = bindImage(object, entry, plan, undefined, (key) => residency.get(key));
    if (!isSameBinding(binding, exact)) return undefined;
    return {
      object,
      transform,
      contentIdentity: identity,
      plan,
      binding,
      residents: residents.flatMap((resident) =>
        resident === undefined
          ? []
          : [
              {
                key: resident.key,
                identity: this.residentId(resident),
                widthPx: resident.widthPx,
                heightPx: resident.heightPx,
              },
            ],
      ),
    };
  }

  private proves(resident: ResidentLevel, identity: string): boolean {
    const proof = this.residents.get(resident);
    const wanted = this.state.planner.wants.get(resident.key);
    return (
      proof?.identity === identity &&
      wanted !== undefined &&
      proof.source === JSON.stringify(wanted.source)
    );
  }

  private residentId(resident: ResidentLevel): number {
    let id = this.residentIds.get(resident);
    if (id === undefined) {
      id = ++this.nextResidentId;
      this.residentIds.set(resident, id);
    }
    return id;
  }
}

function targetKeys(plan: ObjectPlan, recordCount: number): readonly string[] | undefined {
  if (plan.tiles === undefined) return [plan.levelKey];
  if (plan.tiles.length === 0 || plan.tiles.length > recordCount) return undefined;
  return plan.tiles.map(({ key }) => key);
}
