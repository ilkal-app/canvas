import { fittedImageRect, type AssetId, type ObjectId } from '@canvas/schema';

import type { AssetCatalogue } from './asset-catalogue.js';
import type { ImageCandidate } from './image-needs.js';
import type { ResidencyImage } from './residency-image.js';

/**
 * The smallest on-screen size an animated GIF plays at, CSS px on its drawn longer edge: below
 * it the GIF shows its first frame and decodes nothing ().
 */
export const MIN_PLAYING_EDGE_PX = 64;

/** The most GIFs that play at once on a mobile profile (). */
export const MOBILE_MAX_PLAYING = 2;

/** A GIF asset that plays this frame, and the images that draw it playing. */
export interface PlayingAsset {
  /** Its largest image's on-screen size, CSS px. */
  readonly edgePx: number;
  /**
   * Its images on screen at 64 px or more: they draw the shared playback slot; its other images
   * (off screen, or smaller) draw the still level.
   */
  readonly objects: readonly ObjectId[];
}

/** What the selection reads of the frame. */
export interface PlaybackSelectionInput {
  /** The frame's candidates; only the `visible` ones can play. */
  readonly candidates: readonly ImageCandidate[];
  /** The camera zoom, CSS px per world unit. */
  readonly zoom: number;
  /** The most assets that may play; `Infinity` on desktop. */
  readonly maxPlaying: number;
  /** The assets playing last frame: they keep their place when the cap is reached. */
  readonly playing: ReadonlySet<AssetId>;
  /**
   * Whether an image object's asset may animate (a described GIF that is not tiled and not known
   * to be still).
   *
   * @param object - The image object.
   * @returns True when it may.
   */
  isAnimatable(object: ResidencyImage): boolean;
}

/**
 * The on-screen size of an image object: its drawn (fitted) longer edge, CSS px.
 *
 * @param object - The image object.
 * @param zoom - The camera zoom, CSS px per world unit.
 * @returns The size, CSS px.
 */
export function onScreenEdgePx(object: ResidencyImage, zoom: number): number {
  const drawn = fittedImageRect(object);
  return Math.max(drawn.width, drawn.height) * zoom;
}

/**
 * The GIF assets that play this frame, decided per image: an
 * image plays when it is on screen (`visible`) and at least {@link MIN_PLAYING_EDGE_PX} on its
 * drawn longer edge. An asset plays while any of its images does, and one decode and one slot
 * serve all of them; its other images (off screen, or smaller) show the still level. At most
 * `maxPlaying` assets play (the mobile cap counts decoded GIFs, not images): the ones already
 * playing first, then the largest on screen. Pure.
 *
 * @param input - The candidates, zoom, cap and what played last frame.
 * @returns The playing assets: their largest on-screen size, CSS px, and their playing images.
 */
export function selectPlayingAssets(input: PlaybackSelectionInput): Map<AssetId, PlayingAsset> {
  const assets = new Map<AssetId, { edgePx: number; objects: ObjectId[] }>();
  for (const { image, priority } of input.candidates) {
    if (priority !== 'visible' || !input.isAnimatable(image.object)) continue;
    const edgePx = onScreenEdgePx(image.object, input.zoom);
    if (edgePx < MIN_PLAYING_EDGE_PX) continue;
    const { assetId, id } = image.object;
    const asset = assets.get(assetId) ?? { edgePx: 0, objects: [] };
    asset.edgePx = Math.max(asset.edgePx, edgePx);
    asset.objects.push(id);
    assets.set(assetId, asset);
  }
  if (assets.size <= input.maxPlaying) return assets;
  const ranked = [...assets].sort(
    ([firstId, first], [secondId, second]) =>
      Number(input.playing.has(secondId)) - Number(input.playing.has(firstId)) ||
      second.edgePx - first.edgePx ||
      (firstId < secondId ? -1 : 1),
  );
  return new Map(ranked.slice(0, input.maxPlaying));
}

/**
 * The frame's candidates whose asset is a described GIF: only they may play. They are found
 * again only when the candidates may be other images (`candidateRevision`) or the catalogue's
 * GIFs change (`gifRevision`), so a camera-only frame looks at no still image; the
 * candidates' priorities change in place. On the thread that renders.
 */
export class GifCandidates {
  private readonly found: ImageCandidate[] = [];
  private seenCandidates = Number.NaN;
  private seenGifs = Number.NaN;

  /**
   * The GIF candidates of a frame.
   *
   * @param frame - The frame's candidates and their revision.
   * @param frame.candidates - The candidates, live.
   * @param frame.candidateRevision - Changes when they may be other images.
   * @param catalogue - Which assets are described GIFs.
   * @returns The GIF candidates, live, reused by the next call.
   */
  of(
    frame: { readonly candidates: readonly ImageCandidate[]; readonly candidateRevision: number },
    catalogue: AssetCatalogue,
  ): readonly ImageCandidate[] {
    if (
      frame.candidateRevision === this.seenCandidates &&
      catalogue.gifRevision === this.seenGifs
    ) {
      return this.found;
    }
    this.seenCandidates = frame.candidateRevision;
    this.seenGifs = catalogue.gifRevision;
    this.found.length = 0;
    for (const candidate of frame.candidates) {
      if (catalogue.isDescribedGif(candidate.image.object.assetId)) this.found.push(candidate);
    }
    return this.found;
  }
}
