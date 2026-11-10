import type { Point } from '@canvas/schema';
import type { TextLayout } from '@canvas/text';

import { greekQuads } from './greek-quads.js';
import type { OrderedGlyphQuads } from './ordered-glyph-quads.js';

/** Renderer-local reuse of immutable layout bars, independent of atlas state. */
export class SharedGreekQuads {
  private readonly entries = new WeakMap<
    TextLayout,
    {
      readonly x: number;
      readonly y: number;
      readonly quads: OrderedGlyphQuads;
    }
  >();
  /**
   * Builds bars in the object's local frame.
   *
   * @param layout - Immutable completed layout.
   * @param origin - Local text origin; world placement is applied by record preparation.
   * @returns Complete immutable bars.
   */
  get(layout: TextLayout, origin: Point): OrderedGlyphQuads {
    const previous = this.entries.get(layout);
    if (previous?.x === origin.x && previous.y === origin.y) return previous.quads;
    const quads = greekQuads(layout, origin);
    this.entries.set(layout, { x: origin.x, y: origin.y, quads });
    return quads;
  }
}
