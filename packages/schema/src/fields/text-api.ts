/**
 * The public text content API: rich text's runs and its paragraphs' list styles,
 * re-exported from the package root.
 */
export { findRunIssues, findRunsSplittingCharacters, textContentSchema } from './text-content.js';
export type { TextContent } from './text-content.js';
export {
  isSameParagraphStyle,
  MAX_LIST_LEVEL,
  paragraphCount,
  paragraphStyleSchema,
} from './paragraph-style.js';
export type { ParagraphStyle } from './paragraph-style.js';
