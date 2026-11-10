import type { LodForm, LodRule } from './lod-rule.js';
import { LOD_HYSTERESIS } from './lod-thresholds.js';

/**
 * The level of a size under a rule, 0 for `full` and `k` for the rule's `k`-th cheap form,
 * with hysteresis from the previous level: down at once, up one band at a time, each band left
 * only at its threshold × (1 + the rule's `hysteresis`, {@link LOD_HYSTERESIS} by default).
 * Pure.
 *
 * @param rule - The rule.
 * @param screenSizePx - The object's size on screen, device pixels.
 * @param previous - The level it drew at last, if any.
 * @returns The level.
 */
export function lodLevelOf(rule: LodRule, screenSizePx: number, previous?: number): number {
  const { levels } = rule;
  let plain = 0;
  while (plain < levels.length && screenSizePx < (levels[plain]?.belowPx ?? 0)) plain += 1;
  if (previous === undefined || previous <= plain) return plain;
  const band = 1 + hysteresisOf(rule);
  let level = Math.min(previous, levels.length);
  while (level > plain && screenSizePx >= (levels[level - 1]?.belowPx ?? 0) * band) {
    level -= 1;
  }
  return level;
}

/**
 * The form a level stands for.
 *
 * @param rule - The rule.
 * @param level - A level from {@link lodLevelOf}.
 * @returns `full` for 0, else the rule's form.
 */
export function lodFormAt(rule: LodRule, level: number): LodForm {
  return level === 0 ? 'full' : (rule.levels[level - 1]?.form ?? 'full');
}

/**
 * The form an object draws in at its size on screen (the brief's `lodFormOf(kind, screenSize,
 * previous)`): under a threshold it takes the cheaper form at once; it returns to a richer form
 * only once the size is 20% past that form's threshold, so a pinch hovering near a threshold
 * does not flip it every frame. A previous form the rule does not have counts as `full`. Pure.
 *
 * @param rule - The kind's rule (`TEXT_LOD_RULE`, `IMAGE_LOD_RULE`, `PATH_LOD_RULE`, or a
 *   registered one).
 * @param screenSizePx - The object's size on screen, device pixels.
 * @param previous - The form it drew in last, if any.
 * @returns The form.
 */
export function lodFormOf(rule: LodRule, screenSizePx: number, previous?: LodForm): LodForm {
  const previousLevel =
    previous === undefined ? undefined : rule.levels.findIndex(({ form }) => form === previous) + 1;
  return lodFormAt(rule, lodLevelOf(rule, screenSizePx, previousLevel));
}

/**
 * Which side of a threshold's 20% band a size is on, for the no-thrash rule: -1 under the
 * threshold, 1 at or above the threshold × (1 + {@link LOD_HYSTERESIS}), 0 inside the band. A
 * size that goes from one side to the other has traversed the whole band; the band is the
 * brief's, not the rule's own `hysteresis`, so a rule with a narrower band is caught. Pure.
 *
 * @param thresholdPx - The threshold, device pixels.
 * @param screenSizePx - The size on screen, device pixels.
 * @returns -1, 0 or 1.
 */
export function bandSideOf(thresholdPx: number, screenSizePx: number): -1 | 0 | 1 {
  if (screenSizePx < thresholdPx) return -1;
  return screenSizePx >= thresholdPx * (1 + LOD_HYSTERESIS) ? 1 : 0;
}

/**
 * The sizes on screen, ascending and distinct, at which an object's answer under a rule can
 * change: each threshold, the top of its band in the rule ({@link lodLevelOf}) and the top of
 * the 20% band ({@link bandSideOf}). A size change that takes an object across none of them
 * changes nothing, so a zoom need re-evaluate only the objects whose size on screen crossed one.
 * Pure.
 *
 * @param rule - The rule.
 * @returns The edges, device pixels.
 */
export function lodEdgesOf(rule: LodRule): number[] {
  const hysteresis = hysteresisOf(rule);
  const edges = new Set<number>();
  for (const { belowPx } of rule.levels) {
    edges.add(belowPx);
    edges.add(belowPx * (1 + hysteresis));
    edges.add(belowPx * (1 + LOD_HYSTERESIS));
  }
  return [...edges].sort((a, b) => a - b);
}

/**
 * A rule's band, as a fraction of each threshold.
 *
 * @param rule - The rule.
 * @returns Its `hysteresis`, else {@link LOD_HYSTERESIS}.
 */
function hysteresisOf(rule: LodRule): number {
  return rule.hysteresis ?? LOD_HYSTERESIS;
}
