/** One image asset's level choice, as the budget sees it. */
export interface LevelChoice {
  /** The asset. */
  readonly assetId: string;
  /** The long edges it can show, smallest first. */
  readonly levels: readonly number[];
  /** The level the viewport asks for. */
  readonly chosen: number;
  /**
   * The GPU bytes of one of its levels.
   *
   * @param longEdgePx - The level.
   * @returns Bytes.
   */
  bytesOf(longEdgePx: number): number;
}

/**
 * Lowers level choices until they fit a byte budget together (the budget is never exceeded; under
 * pressure images drop to lower levels): while the chosen levels' bytes exceed the budget, the
 * choice costing most steps down one level (ties broken by asset id, so the result is
 * deterministic). Never below each asset's smallest level, which is always resident. Pure; returns
 * the long edge to load per asset.
 *
 * @param choices - The choices.
 * @param budgetBytes - What they may use together.
 * @returns The fitted long edge per asset id.
 */
export function fitLevelsToBudget(
  choices: readonly LevelChoice[],
  budgetBytes: number,
): Map<string, number> {
  // Sorted by asset id, so ties go to the lowest id whatever the input order.
  const fitted = [...choices]
    .sort((a, b) => (a.assetId < b.assetId ? -1 : 1))
    .map((choice) => ({ choice, level: choice.chosen }));
  let total = fitted.reduce((sum, { choice, level }) => sum + choice.bytesOf(level), 0);
  while (total > budgetBytes) {
    let step: { item: (typeof fitted)[number]; bytes: number; lower: number } | undefined;
    for (const item of fitted) {
      const lower = nextLowerLevel(item.choice.levels, item.level);
      const bytes = item.choice.bytesOf(item.level);
      if (lower !== undefined && (step === undefined || bytes > step.bytes)) {
        step = { item, bytes, lower };
      }
    }
    if (step === undefined) break;
    total += step.item.choice.bytesOf(step.lower) - step.bytes;
    step.item.level = step.lower;
  }
  return new Map(fitted.map(({ choice, level }) => [choice.assetId, level]));
}

/**
 * The largest level below a level: the one to step down to.
 *
 * @param levels - The levels, any order.
 * @param current - The level now.
 * @returns The next lower level, or undefined at the smallest.
 */
function nextLowerLevel(levels: readonly number[], current: number): number | undefined {
  let lower: number | undefined;
  for (const level of levels) {
    if (level < current && (lower === undefined || level > lower)) lower = level;
  }
  return lower;
}
