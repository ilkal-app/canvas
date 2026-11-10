// Board search's public surface, re-exported whole from the package's index.
export {
  foldForSearch,
  matchesFoldedQuery,
  matchesQuery,
  searchWordsOf,
} from './fold-and-match.js';
export {
  DEFAULT_SEARCH_LIMIT,
  SearchIndex,
  type SearchHit,
  type SearchOptions,
} from './search-index.js';
export { searchableTextOf, type SearchableText, type SearchGroup } from './searchable-text.js';
