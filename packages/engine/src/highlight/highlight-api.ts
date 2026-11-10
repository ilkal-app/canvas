// The board search highlight's public exports, re-exported whole by the package entry.
export {
  createSearchHighlightLayer,
  SEARCH_HIGHLIGHT_STAGE_NAME,
  SearchHighlightLayer,
} from './search-highlight-layer.js';
export {
  EMPTY_SEARCH_HIGHLIGHT,
  isSearchHighlightModel,
  SEARCH_HIGHLIGHT_ACTIVE_OUTLINE_PX,
  SEARCH_HIGHLIGHT_FILL_ALPHA,
  SEARCH_HIGHLIGHT_OUTLINE_PX,
  SEARCH_HIGHLIGHT_PADDING_PX,
  searchHighlightRectsOf,
} from './search-highlight-model.js';
export type {
  SearchHighlightBox,
  SearchHighlightModel,
  SearchHighlightRect,
} from './search-highlight-model.js';
