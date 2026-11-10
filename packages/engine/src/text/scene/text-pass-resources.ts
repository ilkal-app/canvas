import type { FontFaceKey } from '@canvas/text';

import type { WorkerPool } from '../../workers/worker-pool.js';
import type { FontLibrary } from '../font/font-library.js';

/**
 * A font file to load: the face it is loaded as and where its bytes are (an http(s) or `data:`
 * URL). Plain data, so the page names its fonts in `EngineHostOptions.fontFaces` and the engine
 * worker loads them; the first listed is the default face.
 */
export interface FontFaceSource extends FontFaceKey {
  /** Where the TrueType file is. */
  readonly url: string;
}

/**
 * What the scene's text pass needs on the thread that renders (layout and MSDF generation run
 * in a worker pool): the fonts it lays text out and generates glyphs with,
 * and where it submits its `layout` and `msdf` jobs. The host's owner supplies the fonts as code
 * (`EngineRuntimeExtensions.createTextResources`), since a library does not cross to the engine
 * worker as a message; the jobs go to the runtime's one pool (`EngineJobs`), which runs them on
 * job workers, or on the rendering thread after each frame.
 */
export interface TextPassResources {
  /**
   * The loaded faces, the first the default. Faces may be added after the pass starts (font
   * files load asynchronously): the pass lays text out again when the set of faces changes.
   */
  readonly fonts: FontLibrary;
  /**
   * Takes `layout` and `msdf` jobs. The pass only submits: whoever owns the pool runs its
   * main-thread queue (the engine runtime, after each frame; a test, between frames).
   */
  readonly jobs: Pick<WorkerPool, 'submit'>;
  /**
   * The glyph atlas's byte budget, with 2048 pages. Default: the pass kind's share of the device
   * budget's `atlases` (`textAtlasOptions`), or `DEFAULT_ATLAS_BUDGET_BYTES` with no budget.
   */
  readonly atlasBudgetBytes?: number;
  /**
   * How many texts a frame rewrites at most when their level of detail changes between glyphs
   * and greek bars: a zoom across the threshold spreads the rewrites over frames, the
   * texts not yet rewritten drawn as before. A whole number of at least 1, or `Infinity` for all
   * at once; default 1,000.
   */
  readonly detailRewritesPerFrame?: number;
  /**
   * Whether text shown above 512 device px per em draws from its glyphs' outlines, so it
   * stays sharp at any zoom: the scene's `textVector` companion pass draws those runs, from
   * geometry built by `glyphGeometry` jobs on the same pool. Default false: the atlas tiers alone.
   */
  readonly hasVectorGlyphs?: boolean;
}
