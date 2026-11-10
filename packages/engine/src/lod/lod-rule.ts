/**
 * How an object draws at its size on screen: in `full`, or in a cheap form below a threshold:
 * text as greyed bars (`greek`), an image as its average colour (`average-color`), a path as a
 * straight chord per segment (`chord`), or not at all (`hidden`).
 */
export type LodForm = 'full' | 'greek' | 'average-color' | 'chord' | 'hidden';

/** One cheap form of a rule and the on-screen size under which an object takes it. */
export interface LodLevel {
  /** The form. */
  readonly form: LodForm;
  /** The size, device pixels, under which the form is taken (from a richer one). */
  readonly belowPx: number;
}

/**
 * A level-of-detail rule: the cheap forms of one kind of drawing, richest first, each with the
 * on-screen size under which it is taken; above the first threshold the object draws in
 * `full`. A pass registers a rule with the size it measures (`PassLevelOfDetail`), so a new kind
 * of object adopts a rule by registering, not by changing this module.
 */
export interface LodRule {
  /** A name for reports and tests (`text`, `image`, `path`). */
  readonly kind: string;
  /** The cheap forms, thresholds descending. */
  readonly levels: readonly LodLevel[];
  /**
   * The band above each threshold, a fraction of it: a cheaper form is left only once the size
   * reaches the threshold × (1 + this). `LOD_HYSTERESIS` (20%) when absent. Whatever it is, the
   * no-thrash counter holds the rule to the 20% band (`bandSideOf`), so a narrower band shows
   * up as thrash.
   */
  readonly hysteresis?: number;
}
