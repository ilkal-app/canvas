import type { AssetId, ObjectId } from '@canvas/schema';

import type { FramesJobResponse } from '../workers/job-kinds.js';

import { AnimationLoads } from './animation-loads.js';
import { imageRecordCount } from './bind-image.js';
import { isDescribedGif } from './catalogue-entry.js';
import { FrameDeadline } from './frame-deadline.js';
import type { GifPlaybackOptions, PlaybackFrame } from './gif-playback-options.js';
import {
  GifCandidates,
  MOBILE_MAX_PLAYING,
  selectPlayingAssets,
  type PlayingAsset,
} from './gif-selection.js';
import { animationMomentAt } from './gif-timeline.js';
import { assetOfKey, parseLevelKey } from './image-needs.js';
import type { ResidencyImage } from './residency-image.js';
import { asArrayBufferView } from './resident-level.js';
import { DEFAULT_RETRY_TIMER } from './retry-schedule.js';
import type { ResidentLevel } from './texture-residency.js';

/** The ledger owner (under `textures`) of the decoded GIF frames held for playback. */
export const IMAGE_ANIMATION_OWNER = 'image animation frames';

/** The share of the `textures` budget decoded GIF frames may take together. */
const ANIMATION_BUDGET_SHARE = 0.25;

/** The most bytes one GIF's frames may take: on a desktop, and on a mobile profile. */
const MAX_GIF_BYTES = { desktop: 16 * 1024 * 1024, mobile: 8 * 1024 * 1024 } as const;

/** One GIF asset's playback state. */
interface Animation {
  /** `loading` its frames, `ready` to play, `still` (one frame), `refused` until it leaves. */
  state: 'loading' | 'ready' | 'still' | 'refused';
  reservedBytes: number;
  frames: FramesJobResponse | undefined;
  durationsMs: readonly number[];
  /** When it started playing, ms on the frame clock; undefined while it does not play. */
  startMs: number | undefined;
  /** The frame its slot holds; undefined while it has no slot. */
  shownIndex: number | undefined;
  /** The last frame it was wanted on: paused frames are dropped least recently wanted first. */
  lastWantedFrame: number;
}

/**
 * Plays animated GIFs (as video plays), per client and writing
 * nothing to the document: a GIF image on screen at least 64 px (`selectPlayingAssets`; at most
 * two at once on a mobile profile) has its frames decoded from the original in a job worker
 * (`AnimationLoads`), held as decoded bytes counted under `textures` and held back from the
 * residency's budget (`AnimationBudget`), and shows them in a slot texture of its own (key
 * `<asset>|A`) into which only the current frame is written when it changes. The images of a
 * playing asset draw the slot in place of their level (`shownFor`); every other GIF, and every
 * GIF until its slot is resident, draws its still level, the server's first frame. Frames
 * advance on the frame clock (`animationMomentAt`), and a timer asks for a frame when the next
 * one is due, so a frame that advances no GIF uploads nothing. Under budget pressure the frames
 * are dropped, paused GIFs' first (`relieve`). On the thread that renders.
 */
export class GifPlayback {
  private readonly animations = new Map<AssetId, Animation>();
  private readonly loads: AnimationLoads;
  private readonly playing = new Set<AssetId>();
  /** The images of each wanted asset that draw its slot: on screen at 64 px or more. */
  private images = new Map<AssetId, ReadonlySet<ObjectId>>();
  private readonly toRelease: string[] = [];
  private readonly gifCandidates = new GifCandidates();
  private frameBytes = 0;
  private readonly deadline: FrameDeadline;

  /**
   * Creates the playback; nothing plays until a frame updates it.
   *
   * @param options - The texture manager's parts.
   */
  constructor(private readonly options: GifPlaybackOptions) {
    this.deadline = new FrameDeadline(options.timer ?? DEFAULT_RETRY_TIMER, options.requestFrame);
    this.loads = new AnimationLoads(options.catalogue.assets, options.jobs, {
      onLoaded: (assetId, frames) => {
        this.accept(assetId, frames);
      },
      onFailed: (assetId) => {
        this.drop(assetId, 'refused');
      },
      onQueued: options.requestFrame,
    });
  }

  /**
   * Whether frames are being fetched or decoded.
   *
   * @returns True while a load runs.
   */
  get isLoading(): boolean {
    return this.loads.isLoading;
  }

  /**
   * The slot an image draws in place of a resident level: only an image that plays itself (on
   * screen at 64 px or more) of a playing asset; the asset's other images draw the level.
   *
   * @param key - A level key the binding looks up.
   * @param id - The image being bound.
   * @param residentOf - The residency's own lookup.
   * @returns The slot, or undefined to draw the level itself.
   */
  shownFor(
    key: string,
    id: ObjectId,
    residentOf: (key: string) => ResidentLevel | undefined,
  ): ResidentLevel | undefined {
    if (this.playing.size === 0) return undefined;
    const assetId = assetOfKey(key);
    if (!this.playing.has(assetId) || this.images.get(assetId)?.has(id) !== true) return undefined;
    if (parseLevelKey(key) === undefined) return undefined;
    if (residentOf(key) === undefined) return undefined;
    return residentOf(slotKey(assetId));
  }

  /**
   * Plays the frame: picks the GIFs that play, starts and stops them, and writes each playing
   * GIF's current frame into its slot when it changed. Runs after the texture manager planned;
   * the assets that started or stopped are rebound by the next plan, and a stopped GIF's slot is
   * kept until then (`settle`).
   *
   * @param frame - The frame's candidates, zoom, time and needs.
   */
  update(frame: PlaybackFrame): void {
    const wanted = selectPlayingAssets({
      candidates: this.gifCandidates.of(frame, this.options.catalogue),
      zoom: frame.zoom,
      maxPlaying: this.options.isMobile ? MOBILE_MAX_PLAYING : Infinity,
      playing: this.playing,
      isAnimatable: (object) => this.isAnimatable(object),
    });
    this.noteImages(wanted);
    for (const [assetId, animation] of [...this.animations]) {
      if (wanted.has(assetId)) continue;
      if (animation.state === 'refused') this.animations.delete(assetId);
      if (animation.state === 'loading') this.drop(assetId, undefined);
      if (this.playing.has(assetId)) this.stop(assetId, animation);
    }
    let deadlineMs = Infinity;
    for (const assetId of wanted.keys()) {
      const next = this.play(assetId, frame);
      if (next !== undefined) deadlineMs = Math.min(deadlineMs, next);
    }
    this.deadline.request(deadlineMs, frame.timeMs);
  }

  /**
   * Keeps which images of each wanted asset play, and rebinds a playing asset whose playing
   * images changed: one that shrank under 64 px or left the screen draws the still level again.
   *
   * @param wanted - The frame's playing assets and their playing images.
   */
  private noteImages(wanted: ReadonlyMap<AssetId, PlayingAsset>): void {
    const images = new Map<AssetId, ReadonlySet<ObjectId>>();
    for (const [assetId, { objects }] of wanted) {
      const now = new Set(objects);
      const before = this.images.get(assetId);
      const isSame = before?.size === now.size && objects.every((id) => before.has(id));
      if (!isSame && this.playing.has(assetId)) this.options.onChanged(assetId);
      images.set(assetId, now);
    }
    this.images = images;
  }

  /**
   * Frees the slots of the GIFs that stopped last frame, once the plan since has rebound their
   * images to their levels.
   */
  settle(): void {
    for (const key of this.toRelease.splice(0)) this.options.residency.evict(key);
  }

  /**
   * Gives memory back under budget pressure (a needed level did not fit): the frames of the
   * least recently wanted paused GIF, or else of the playing GIF whose frames take the most,
   * which then waits until it leaves the screen (or drops below 64 px) before it may play again.
   */
  relieve(): void {
    let victim: AssetId | undefined;
    let victimRank = -Infinity;
    for (const [assetId, animation] of this.animations) {
      if (animation.reservedBytes === 0) continue;
      // Paused GIFs rank above playing ones, the least recently wanted first.
      const rank = this.playing.has(assetId)
        ? animation.reservedBytes
        : Number.MAX_SAFE_INTEGER - animation.lastWantedFrame;
      if (rank > victimRank) {
        victim = assetId;
        victimRank = rank;
      }
    }
    if (victim !== undefined) this.drop(victim, 'refused');
  }

  /** Stops every load and the timer and drops every frame; the residency frees the slots. */
  destroy(): void {
    this.loads.destroy();
    this.deadline.stop();
    this.animations.clear();
    this.playing.clear();
    this.options.ledger.delete('textures', IMAGE_ANIMATION_OWNER);
  }

  private isAnimatable(object: ResidencyImage): boolean {
    // An image paint shows its still level; only image objects play.
    if (object.type !== 'image') return false;
    if (this.animations.get(object.assetId)?.state === 'still') return false;
    return (
      isDescribedGif(this.options.catalogue.peek(object.assetId)) && imageRecordCount(object) === 1
    );
  }

  /**
   * Plays one wanted asset this frame: loads its frames, starts it, or advances it.
   *
   * @param assetId - The asset.
   * @param frame - The frame.
   * @returns When its next frame is due, ms on the frame clock, if it plays on.
   */
  private play(assetId: AssetId, frame: PlaybackFrame): number | undefined {
    const animation = this.animations.get(assetId) ?? this.load(assetId, frame.isNeeded);
    if (animation === undefined) return undefined;
    animation.lastWantedFrame = frame.frameIndex;
    const { frames } = animation;
    if (animation.state !== 'ready' || frames === undefined) return undefined;
    const isStarting = animation.startMs === undefined;
    const startMs = animation.startMs ?? frame.timeMs;
    animation.startMs = startMs;
    const moment = animationMomentAt(animation.durationsMs, frames.plays, frame.timeMs - startMs);
    const slot = this.options.residency.get(slotKey(assetId));
    if (animation.shownIndex !== undefined && slot === undefined) {
      // The residency evicted the slot to fit a level: pressure.
      this.drop(assetId, 'refused');
      return undefined;
    }
    if (
      moment.index !== animation.shownIndex &&
      !this.write(assetId, animation, moment.index, frame)
    ) {
      this.drop(assetId, 'refused');
      return undefined;
    }
    const written = this.options.residency.get(slotKey(assetId));
    if (written !== undefined) written.lastUsedFrame = frame.frameIndex;
    if (isStarting || !this.playing.has(assetId)) {
      this.playing.add(assetId);
      this.options.onChanged(assetId);
    }
    return moment.nextChangeMs === undefined ? undefined : startMs + moment.nextChangeMs;
  }

  /**
   * Starts loading an asset's frames when the budget can hold the most they may take, idle
   * levels making room.
   *
   * @param assetId - The asset.
   * @param isNeeded - Whether a resident key is needed now: idle levels make room.
   * @returns Its animation, or undefined when there is no room now.
   */
  private load(assetId: AssetId, isNeeded: (key: string) => boolean): Animation | undefined {
    const { isMobile, texturesBytes } = this.options;
    const maxBytes = isMobile ? MAX_GIF_BYTES.mobile : MAX_GIF_BYTES.desktop;
    if (this.reservedTotal() + maxBytes > texturesBytes * ANIMATION_BUDGET_SHARE) {
      this.dropPaused();
      if (this.reservedTotal() + maxBytes > texturesBytes * ANIMATION_BUDGET_SHARE)
        return undefined;
    }
    if (!this.options.budget.reserve(maxBytes, isNeeded)) return undefined;
    const animation: Animation = {
      state: 'loading',
      reservedBytes: maxBytes,
      frames: undefined,
      durationsMs: [],
      startMs: undefined,
      shownIndex: undefined,
      lastWantedFrame: 0,
    };
    this.animations.set(assetId, animation);
    this.loads.start(assetId, maxBytes);
    return animation;
  }

  /**
   * Writes a frame into an asset's slot: the first time through the residency, then in place.
   *
   * @param assetId - The asset.
   * @param animation - Its playback.
   * @param index - The frame.
   * @param frame - The frame being drawn.
   * @returns Whether the slot holds the frame now.
   */
  private write(
    assetId: AssetId,
    animation: Animation,
    index: number,
    frame: PlaybackFrame,
  ): boolean {
    const { frames } = animation;
    const pixels = frames?.frames[index];
    if (frames === undefined || pixels === undefined) return false;
    const key = slotKey(assetId);
    const slot = this.options.residency.get(key);
    if (slot?.texture !== undefined) {
      this.options.backend.writeTexture(slot.texture, asArrayBufferView(pixels.rgba));
    } else {
      const level = { widthPx: frames.widthPx, heightPx: frames.heightPx, rgba: pixels.rgba };
      const placed = this.options.residency.upload(key, level, frame.frameIndex, frame.isNeeded);
      if (typeof placed === 'string') return false;
    }
    animation.shownIndex = index;
    return true;
  }

  private stop(assetId: AssetId, animation: Animation): void {
    this.playing.delete(assetId);
    animation.startMs = undefined;
    if (animation.shownIndex !== undefined) this.toRelease.push(slotKey(assetId));
    animation.shownIndex = undefined;
    this.options.onChanged(assetId);
  }

  private accept(assetId: AssetId, frames: FramesJobResponse): void {
    const animation = this.animations.get(assetId);
    if (animation === undefined) return;
    if (frames.frames.length < 2) {
      this.drop(assetId, 'still');
      return;
    }
    const bytes = frames.frames.reduce((sum, { rgba }) => sum + rgba.byteLength, 0);
    this.options.budget.release(Math.max(0, animation.reservedBytes - bytes));
    animation.reservedBytes = Math.min(animation.reservedBytes, bytes);
    animation.frames = frames;
    animation.durationsMs = frames.frames.map(({ durationMs }) => durationMs);
    animation.state = 'ready';
    this.frameBytes += animation.reservedBytes;
    this.report();
    this.options.requestFrame();
  }

  /**
   * Drops an asset's frames and load, gives its bytes back and stops it.
   *
   * @param assetId - The asset.
   * @param state - What it becomes: `still`, `refused`, or forgotten (undefined).
   */
  private drop(assetId: AssetId, state: 'still' | 'refused' | undefined): void {
    const animation = this.animations.get(assetId);
    if (animation === undefined) return;
    this.loads.cancel(assetId);
    if (this.playing.has(assetId)) this.stop(assetId, animation);
    if (animation.state === 'ready') this.frameBytes -= animation.reservedBytes;
    this.options.budget.release(animation.reservedBytes);
    this.report();
    if (state === undefined) {
      this.animations.delete(assetId);
      return;
    }
    Object.assign(animation, { state, reservedBytes: 0, frames: undefined, durationsMs: [] });
  }

  private dropPaused(): void {
    const paused = [...this.animations]
      .filter(([assetId, animation]) => animation.state === 'ready' && !this.playing.has(assetId))
      .sort(([, first], [, second]) => first.lastWantedFrame - second.lastWantedFrame);
    for (const [assetId] of paused) this.drop(assetId, undefined);
  }

  private reservedTotal(): number {
    let total = 0;
    for (const animation of this.animations.values()) total += animation.reservedBytes;
    return total;
  }

  private report(): void {
    this.options.ledger.set('textures', IMAGE_ANIMATION_OWNER, this.frameBytes);
  }
}

/**
 * The key of an asset's playback slot in the residency.
 *
 * @param assetId - The asset.
 * @returns The key.
 */
function slotKey(assetId: AssetId): string {
  return `${assetId}|A`;
}
