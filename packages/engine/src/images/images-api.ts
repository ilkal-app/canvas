// The images area's public API (the client texture manager and the image pass), re-exported by
// the package entry, src/index.ts, which would otherwise pass 400 lines.
export { AssetCatalogue } from './asset-catalogue.js';
export type { CatalogueEntry, CatalogueListener } from './asset-catalogue.js';
export type {
  AssetSource,
  AssetTileKey,
  ImageAssetInfo,
  ImageAssetListener,
  ImageAssetTiles,
} from './asset-source.js';
export { pendingImageAssetInfo } from './asset-source.js';
export { createFixtureAssetSource, fixtureAssetId } from './fixture-asset-source.js';
export type {
  FixtureAssetOptions,
  FixtureAssetSource,
  FixtureAssetSpec,
  FixtureFetch,
} from './fixture-asset-source.js';
export {
  ANIMATED_FIXTURE_PREFIX,
  ANIMATED_FIXTURE_SPEC,
  encodeFixtureAnimation,
  encodeFixtureGif,
  FIXTURE_GIF_FRAME_COLORS,
} from './fixture-gif.js';
export type {
  FixtureAnimatedAsset,
  FixtureAnimationSpec,
  FixtureGifFrame,
  FixtureGifRect,
  FixtureGifSpec,
} from './fixture-gif.js';
export { FIXTURE_LEVEL_BAND_COLORS, fixtureLevelBand } from './fixture-image.js';
export { IMAGE_ANIMATION_OWNER } from './gif-playback.js';
export { MIN_PLAYING_EDGE_PX, MOBILE_MAX_PLAYING } from './gif-selection.js';
export { ATLAS_MAX_ITEM_PX } from './image-atlas.js';
export { MAX_TILE_PARTS } from './image-needs.js';
export type { AssetView, LevelEntry } from './image-needs.js';
export type { BindingPart, ImageBinding, ImageSource, PageRegion } from './image-binding.js';
export {
  IMAGE_LEVEL_OF_DETAIL,
  IMAGE_PASS,
  IMAGE_PASS_NAME,
  IMAGE_STAGE_NAME,
} from './image-pass.js';
export { createImagePassSupport, NO_IMAGE_ASSETS } from './image-pass-support.js';
export type { ImagePassSupport } from './image-pass-support.js';
export type {
  ClientLevelSource,
  ImageJobRunner,
  LevelSource,
  ServerLevelSource,
  TileLevelSource,
} from './level-loader.js';
export {
  LEVEL_DOWN_RATIO,
  LEVEL_UP_SLACK,
  levelSize,
  pickLevel,
  requiredLongEdgePx,
} from './level-selection.js';
export type { Size } from './level-selection.js';
export {
  MAX_PREFETCH_VIEWPORTS,
  PREFETCH_LOOKAHEAD_MS,
  prefetchViewport,
  viewportVelocity,
} from './prefetch.js';
export type { WorldVelocity } from './prefetch.js';
export { DEFAULT_RETRY_TIMER, RETRY_DELAYS_MS, RetrySchedule } from './retry-schedule.js';
export type { RetryTimer } from './retry-schedule.js';
export type { TileAddress, UnitRect } from './tiles.js';
export { TextureManager } from './texture-manager.js';
export type {
  ImageFrameInput,
  ImageFrameResult,
  TextureManagerOptions,
  TextureManagerStats,
} from './texture-manager-options.js';
export { IMAGE_ATLAS_OWNER, IMAGE_LEVELS_OWNER } from './texture-residency.js';
