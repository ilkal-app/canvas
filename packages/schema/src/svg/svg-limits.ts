// The caps on an SVG import. The markup is untrusted (an agent passes what a design tool
// handed it), so every quantity the import walks is bounded before it is walked: the markup's
// length, the elements read, how deep they nest, the elements visited and the depth reached once
// `<use>` references are expanded, the objects made and the vertices in them: a document over any
// of these is refused whole. Two caps bound work instead, and are reported when reached: gradient
// `href` chains and the fill-rule check.

/** The caps on one SVG import. */
export const SVG_IMPORT_LIMITS = Object.freeze({
  /** The longest markup, in UTF-16 code units: 256 KiB of ASCII. */
  maxMarkupLength: 262_144,
  /** The most elements the markup may hold. */
  maxElements: 10_000,
  /** The deepest element nesting. */
  maxDepth: 64,
  /** The most elements visited while drawing, `<use>` expansions included. */
  maxVisitedElements: 20_000,
  /** The deepest nesting while drawing, `<use>` references included: bounds the recursion. */
  maxDrawDepth: 256,
  /** The longest chain of gradient `href`s followed. */
  maxGradientChain: 32,
  /**
   * The edge operations the nonzero fill-rule check may spend over the whole import (each check
   * costs edges² plus edges per sample, so one outline of the most edges a check takes); past
   * it, a fill rule is reported as not checked.
   */
  maxFillRuleWork: 4_000_000,
  /** The most board objects one import makes. */
  maxObjects: 2_000,
  /** The most path vertices one import makes, over all its objects. */
  maxVertices: 100_000,
});
