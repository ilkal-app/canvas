import type { ObjectId } from '@canvas/schema';

import type { LevelOfDetail } from './level-of-detail.js';

/**
 * Captures actual hysteresis forms; a reopened renderer must produce the same non-full plan.
 * Full is implicit, so ordinary geometry does not add one record per object to the sidecar.
 *
 * @param state - The completed frame's level-of-detail state.
 * @param passNames - Recognized passes with a level-of-detail rule.
 * @param scope - The objects a preview holds (a certificate's candidates), when keyed for one:
 *   the visible set is padded past the coverage, and a reopened preview holds only what
 *   the coverage met, so the padding's forms are never reproduced. Default the visible set.
 * @returns Deterministic bounded key, or undefined without a finite visible set.
 */
export function lodPreviewKey(
  state: Pick<LevelOfDetail, 'visibleIds' | 'formOf'>,
  passNames: readonly string[],
  scope?: readonly ObjectId[],
): string | undefined {
  if (passNames.length === 0) return '[]';
  const visible = state.visibleIds;
  if (visible === undefined) return undefined;
  const parts: string[] = [];
  let length = 2;
  const isVisible = new Set(visible);
  const ids = (scope === undefined ? [...visible] : scope.filter((id) => isVisible.has(id))).sort();
  for (const pass of [...passNames].sort()) {
    for (const id of ids) {
      const form = state.formOf(pass, id);
      if (form === 'full') continue;
      const key = JSON.stringify([pass, id, form]);
      length += key.length + 1;
      if (length > 4 * 1024 * 1024) return undefined;
      parts.push(key);
    }
  }
  return `[${parts.join(',')}]`;
}
