import type { TextLayout } from '@canvas/text';

import type { SceneObject } from '../../scene/scene-pass.js';
import {
  cappedTextTier,
  pickTextTier,
  type TextTier,
  type TextTierOptions,
} from '../atlas/glyph-tiers.js';

import type { OrderedGlyphQuads } from './ordered-glyph-quads.js';
import type { TextBoxGeometry } from './text-placement.js';

/** What the text pass keeps per text object. */
export interface TextObjectEntry {
  /** The object and transform last prepared. */
  target: SceneObject;
  /** Its text box. */
  geometry: TextBoxGeometry;
  /** The layout its quads were built from. */
  builtLayout: TextLayout | undefined;
  /** The quads, one per drawable glyph; undefined before the first layout lands. */
  quads: OrderedGlyphQuads | undefined;
  /** Whether the quads must be rebuilt at the next prepare (tier, atlas or fonts changed). */
  isStale: boolean;
  /** Whether the quads are greek bars (the text's level of detail), not glyphs. */
  isGreek: boolean;
}

/**
 * Whether an object's text would pick other tiers at a scale than its quads did: its records
 * must then be rebuilt (the tier cascade switches with hysteresis).
 *
 * @param entry - The object.
 * @param scale - Device px per world unit now.
 * @param options - Whether the pass draws the vector tier.
 * @returns Whether a run's tier changes.
 */
export function hasTierChange(
  entry: TextObjectEntry,
  scale: number,
  options?: TextTierOptions,
): boolean {
  const { quads, builtLayout } = entry;
  if (quads === undefined || builtLayout === undefined) return false;
  return builtLayout.runs.some((run, index) => {
    const previous: TextTier | undefined = quads.tiers[index];
    const next = cappedTextTier(
      pickTextTier(run.fontSize * scale, previous, options),
      quads.maxTier,
    );
    return next !== previous;
  });
}

/**
 * Whether two boxes place laid-out text alike: the same origin, vertical alignment and height.
 * The rest of a box (content, width, alignment) is the layout's key, so a new layout covers it.
 *
 * @param first - One box.
 * @param second - The other.
 * @returns Whether glyph quads built for one fit the other.
 */
export function isSamePlacement(first: TextBoxGeometry, second: TextBoxGeometry): boolean {
  return (
    first.origin.x === second.origin.x &&
    first.origin.y === second.origin.y &&
    first.verticalAlign === second.verticalAlign &&
    first.boxHeight === second.boxHeight
  );
}
