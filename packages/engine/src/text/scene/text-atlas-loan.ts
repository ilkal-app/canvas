import type { AtlasLoan } from '../../memory/atlas-loan.js';
import type { ScenePassEnvironment } from '../../scene/scene-pass.js';
import { glyphAtlasSizing, textAtlasOptions } from '../atlas/glyph-atlas-sizing.js';
import { GlyphAtlas } from '../atlas/glyph-atlas.js';

import { TEXT_PASS_NAME, type TextPassKind } from './text-pass-definition.js';
import type { TextPassResources } from './text-pass-resources.js';

/** A text pass's atlas and what sizes it when a frame starts. */
export interface LoanedTextAtlas {
  /** The atlas. */
  readonly atlas: GlyphAtlas;
  /** Sets the atlas's budget for the frame; run after the atlas's `beginFrame`. */
  readonly borrow: () => void;
}

/**
 * A text pass's atlas. The scene text pass with the environment's loan, a device
 * budget and no explicit atlas budget borrows texture memory nobody uses: its own budget is as
 * `textAtlasOptions` gives it; each frame it may grow by what the textures can lend; its pages are
 * as large as what it could borrow allows, but one always fits its own budget, so it never keeps
 * borrowed bytes the textures want (`loanPageSize`). The bytes past its own budget are what it
 * borrows, and it gives them back at once when images want them. Its single-channel pages have
 * twice the side, an RGBA page's bytes, where the backend allows, so CJK text in
 * single-channel fields spreads over fewer pages. Every other pass: the atlas at its own budget,
 * as before.
 *
 * @param environment - The pass's environment: its budget, its loan and the backend.
 * @param resources - Its text resources: an explicit atlas budget, if any.
 * @param kind - The pass's kind: its name and share of the atlases.
 * @returns The atlas, and what to run when a frame starts.
 */
export function loanedTextAtlas(
  environment: Pick<ScenePassEnvironment, 'budget' | 'atlasLoan' | 'backend'>,
  resources: Pick<TextPassResources, 'atlasBudgetBytes'>,
  kind: Pick<TextPassKind, 'name' | 'atlasShare'>,
): LoanedTextAtlas {
  const { budget, atlasLoan: loan } = environment;
  const explicitBytes = resources.atlasBudgetBytes;
  const own = textAtlasOptions(budget, explicitBytes, kind.atlasShare);
  if (
    loan === undefined ||
    budget === undefined ||
    explicitBytes !== undefined ||
    kind.name !== TEXT_PASS_NAME ||
    own.budgetBytes === undefined
  ) {
    return { atlas: new GlyphAtlas(own), borrow: () => undefined };
  }
  const ownBytes = own.budgetBytes;
  const pageSize = loanPageSize(ownBytes, loan);
  const atlas = new GlyphAtlas({
    budgetBytes: ownBytes,
    pageSize,
    singleChannelPageSize: Math.min(2 * pageSize, environment.backend.capabilities.maxTextureSize),
  });
  loan.attachBorrower(
    () => atlas.memory().residentBytes - ownBytes,
    (borrowedBytes) => {
      atlas.setBudget(ownBytes + borrowedBytes, true);
    },
  );
  return {
    atlas,
    borrow: () => {
      atlas.setBudget(ownBytes + loan.lendableBytes);
    },
  };
}

/** The page sides a borrowing atlas may use, largest first. */
const LOAN_PAGE_SIZES = [2048, 1024, 512] as const;

/**
 * A borrowing atlas's page side: as large as what it could borrow allows, since its
 * shader picks a page per glyph and glyphs spread over many small pages make neighbouring
 * fragments diverge (seven 1024-texel pages drew a CJK board at 12 ms of WebGL2 GPU, two 2048-texel
 * pages at 3), but no larger than one page of its own budget, so giving back all it borrowed
 * never takes its last page.
 *
 * @param ownBytes - Its own budget.
 * @param loan - The loan.
 * @returns The side.
 */
function loanPageSize(ownBytes: number, loan: AtlasLoan): number {
  const { pageSize } = glyphAtlasSizing(ownBytes + loan.lendableBytes, 1);
  return LOAN_PAGE_SIZES.find((size) => size <= pageSize && size * size * 4 <= ownBytes) ?? 512;
}
