import {
  IMAGE_LEVEL_LONG_EDGES_PX,
  TILE_SIZE_PX,
  type AssetId,
  type AssetTiles,
} from '@canvas/schema';

import type {
  AssetSource,
  AssetTileKey,
  ImageAssetInfo,
  ImageAssetListener,
  ImageAssetTiles,
} from './asset-source.js';
import {
  ANIMATED_FIXTURE_PREFIX,
  ANIMATED_FIXTURE_SPEC,
  encodeFixtureAnimation,
  type FixtureAnimationSpec,
} from './fixture-gif.js';
import { encodeFixtureImage } from './fixture-image.js';
import { levelSize, type Size } from './level-selection.js';
import { tilesCovering } from './tiles.js';

/** How one fixture asset looks. */
export interface FixtureAssetSpec {
  /** The original's size, px. */
  readonly naturalSize: Size;
  /**
   * Whether the server's levels exist from the start. Default true; false describes the asset
   * with no levels until `publishLevels`, so the client resizes the original.
   */
  readonly hasServerLevels?: boolean;
  /**
   * Makes the asset an animated GIF: described as `image/gif`, its original a GIF of
   * solid frames (`encodeFixtureAnimation`) and its server levels still GIFs of the first frame.
   */
  readonly animation?: FixtureAnimationSpec;
}

/** One fetch, as the fixture's gate sees it. */
export interface FixtureFetch {
  /** What is fetched. */
  readonly kind: 'level' | 'tile' | 'original';
  /** The asset. */
  readonly assetId: AssetId;
  /** The level's long edge for a level, the tile's level for a tile, else undefined. */
  readonly longEdgePx: number | undefined;
}

/** Options for {@link createFixtureAssetSource}. */
export interface FixtureAssetOptions {
  /** Assets by id; an id not listed gets a size made up from its hash. */
  readonly assets?: Readonly<Record<string, FixtureAssetSpec>>;
  /**
   * Awaited before each fetch answers, to add latency (a scenario's slow network) or hold a
   * level back. Default: answers at once.
   */
  readonly beforeFetch?: (request: FixtureFetch) => Promise<void>;
}

/**
 * The media type fixture originals are described with: the decode job recognises fixture images
 * by their header whatever the type says.
 */
export const FIXTURE_IMAGE_MIME_TYPE = 'image/x-canvas-fixture';

/**
 * Waits for a fetch's gate, but rejects as soon as its signal aborts (a
 * cancelled load gives its slot back at once), and afterwards when it aborted meanwhile.
 *
 * @param gate - The gate.
 * @param signal - The fetch's signal, if any.
 * @returns Resolves when the fetch may answer.
 */
async function passGate(gate: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) {
    await gate;
    return;
  }
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason as Error);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    gate.then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
  signal.throwIfAborted();
}

/** A fixture asset source: an {@link AssetSource} whose server levels can be published later. */
export interface FixtureAssetSource extends AssetSource {
  /**
   * Makes an asset's server levels exist (for one described with `hasServerLevels: false`) and
   * tells its subscribers.
   *
   * @param assetId - The asset.
   */
  publishLevels(assetId: AssetId): void;
}

/**
 * Names a fixture asset: asset ids are branded, and fixtures pick theirs freely.
 *
 * @param name - The id, 1 to 128 of `[A-Za-z0-9_-]`.
 * @returns The id as an `AssetId`.
 */
export function fixtureAssetId(name: string): AssetId {
  return name as AssetId;
}

function hashOf(seed: number, text: string): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The tile pyramid of an original too large for the largest level: its levels above 4096 px.
 *
 * @param naturalSize - The original's size, px.
 * @returns The pyramid, or null for an original the levels cover.
 */
function tilesFor(naturalSize: Size): AssetTiles | null {
  const longEdge = Math.max(naturalSize.width, naturalSize.height);
  const largest = IMAGE_LEVEL_LONG_EDGES_PX.at(-1) ?? 0;
  if (longEdge <= largest) return null;
  // As the assets service tiles: only the levels whose long edge exceeds the largest
  // resized level, halving from full resolution.
  let levels = 0;
  while (longEdge / 2 ** levels > largest) levels += 1;
  return { tileSizePx: TILE_SIZE_PX, levels, format: 'webp' };
}

/**
 * A size for an asset the options do not list, made up from its id's hash.
 *
 * @param seed - The source's seed.
 * @param assetId - The asset.
 * @returns Its spec: 1200 to 4000 px wide, half to nearly as tall.
 */
function madeUpSpec(seed: number, assetId: AssetId): FixtureAssetSpec {
  if (assetId.startsWith(ANIMATED_FIXTURE_PREFIX)) return ANIMATED_FIXTURE_SPEC;
  const hash = hashOf(seed, assetId);
  const width = 1200 + (hash % 2800);
  return { naturalSize: { width, height: Math.round(width * (0.5 + ((hash >>> 12) % 50) / 100)) } };
}

/**
 * A fixture asset's description.
 *
 * @param seed - The source's seed.
 * @param assetId - The asset.
 * @param spec - Its size and whether its levels exist from the start.
 * @param isPublished - Whether `publishLevels` was called for it.
 * @returns The description.
 */
function describeFixture(
  seed: number,
  assetId: AssetId,
  spec: FixtureAssetSpec,
  isPublished: boolean,
): ImageAssetInfo {
  const longEdge = Math.max(spec.naturalSize.width, spec.naturalSize.height);
  const hasLevels = spec.hasServerLevels !== false || isPublished;
  const blue = 40 + (hashOf(seed, assetId) % 180);
  return {
    mimeType: spec.animation === undefined ? FIXTURE_IMAGE_MIME_TYPE : 'image/gif',
    naturalSize: spec.naturalSize,
    levels: hasLevels
      ? IMAGE_LEVEL_LONG_EDGES_PX.filter((edge) => edge < longEdge).map((edge) => ({
          longEdgePx: edge,
          format: 'webp' as const,
        }))
      : [],
    tiles: tilesFor(spec.naturalSize),
    averageColor: [135 / 255, 135 / 255, blue / 255, 1],
    blurhash: null,
  };
}

/**
 * Creates an asset source of seeded synthetic images for tests, golden scenes and benchmarks:
 * every asset is a fixture image
 * (`encodeFixtureImage`) with the server's levels below its long edge and, when it is larger
 * than 4096 px, a 256 px tile pyramid; an asset with an `animation`, or an unlisted one whose id
 * starts with `animated-gif-` (`ANIMATED_FIXTURE_SPEC`), is an animated GIF instead. Descriptions
 * and bytes depend only on the seed and the asset id. Answers on the calling thread; the pixels are made by the `decode` job.
 *
 * @param seed - The seed of every image's colours and of made-up sizes.
 * @param options - Listed assets and a fetch gate.
 * @returns The source.
 */
export function createFixtureAssetSource(
  seed: number,
  options: FixtureAssetOptions = {},
): FixtureAssetSource {
  const published = new Set<AssetId>();
  const listeners = new Map<AssetId, Set<ImageAssetListener>>();
  const gate = options.beforeFetch ?? (() => Promise.resolve());

  const specOf = (assetId: AssetId): FixtureAssetSpec =>
    options.assets?.[assetId] ?? madeUpSpec(seed, assetId);
  const infoOf = (assetId: AssetId): ImageAssetInfo =>
    describeFixture(seed, assetId, specOf(assetId), published.has(assetId));
  const encode = (assetId: AssetId, size: Size, region = WHOLE_IMAGE): ArrayBuffer => {
    const { animation } = specOf(assetId);
    if (animation !== undefined) return encodeFixtureAnimation(size, animation, 1);
    return encodeFixtureImage({
      seed,
      assetKey: assetId,
      widthPx: size.width,
      heightPx: size.height,
      region,
    });
  };
  const original = (assetId: AssetId): ArrayBuffer => {
    const { animation, naturalSize } = specOf(assetId);
    if (animation === undefined) return encode(assetId, naturalSize);
    const key = JSON.stringify({ naturalSize, animation });
    const bytes = ANIMATED_ORIGINALS.get(key) ?? encodeFixtureAnimation(naturalSize, animation);
    ANIMATED_ORIGINALS.set(key, bytes);
    return bytes.slice(0);
  };

  return {
    describe: (assetId) => Promise.resolve(infoOf(assetId)),
    async fetchLevel(assetId, longEdgePx, signal) {
      const info = infoOf(assetId);
      if (!info.levels.some((level) => level.longEdgePx === longEdgePx)) {
        throw new RangeError(`Asset ${assetId} has no ${String(longEdgePx)} px level.`);
      }
      await passGate(gate({ kind: 'level', assetId, longEdgePx }), signal);
      return encode(assetId, levelSize(specOf(assetId).naturalSize, longEdgePx));
    },
    async fetchTile(assetId, tile, signal) {
      const { tiles } = infoOf(assetId);
      const { naturalSize } = specOf(assetId);
      const found = tiles === null ? undefined : findTile(naturalSize, tiles, tile);
      if (found === undefined) {
        throw new RangeError(`Asset ${assetId} has no tile ${JSON.stringify(tile)}.`);
      }
      await passGate(gate({ kind: 'tile', assetId, longEdgePx: tile.level }), signal);
      return encode(assetId, { width: found.widthPx, height: found.heightPx }, found.rect);
    },
    async fetchOriginal(assetId, signal) {
      await passGate(gate({ kind: 'original', assetId, longEdgePx: undefined }), signal);
      return original(assetId);
    },
    subscribe(assetId, listener) {
      const set = listeners.get(assetId) ?? new Set();
      set.add(listener);
      listeners.set(assetId, set);
      return () => {
        set.delete(listener);
      };
    },
    publishLevels(assetId) {
      published.add(assetId);
      const info = infoOf(assetId);
      for (const listener of listeners.get(assetId) ?? []) listener(info);
    },
  };
}

const WHOLE_IMAGE = { minU: 0, minV: 0, maxU: 1, maxV: 1 };

/**
 * Animated fixture originals by spec, encoded once per thread: every source and every made-up
 * `animated-gif-…` asset of a benchmark board share one encoding; fetches get copies.
 */
const ANIMATED_ORIGINALS = new Map<string, ArrayBuffer>();

function findTile(naturalSize: Size, tiles: ImageAssetTiles, key: AssetTileKey) {
  if (key.level < 0 || key.level >= tiles.levels) return undefined;
  return tilesCovering(WHOLE_IMAGE, naturalSize, tiles, key.level).find(
    (tile) => tile.column === key.column && tile.row === key.row,
  );
}
