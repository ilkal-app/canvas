// The CJK slices' public API: slicing, the slice faces, and which slices a text needs,
// re-exported by the package entry, src/index.ts, as one line, so other areas' exports added there
// never collide with these.
export { buildCjkSlices } from './build-cjk-slices.js';
export { cjkSliceFace, cjkSliceIdOf, cjkSliceOf, cjkSlices } from './cjk-slices.js';
export { createSubsetter } from './subsetter.js';
export type { Subsetter } from './subsetter.js';
export { coverageNeeds, type CoverageNeed } from '../symbols/coverage-needs.js';
export { CoverageNeedsCache } from '../symbols/coverage-needs-cache.js';
export { effectiveLanguage, KanaParagraphs } from '../script/run-language.js';
