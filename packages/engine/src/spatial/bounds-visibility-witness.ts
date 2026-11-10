import type { WorldBounds } from '../camera/camera.js';

import { intersectsBounds } from './bounds.js';

/** Constant-size proof that fixed candidate boxes keep their intersection classifications. */
export class BoundsVisibilityWitness {
  private isValid = true;
  private visibleMinX = Infinity;
  private visibleMinY = Infinity;
  private visibleMaxX = -Infinity;
  private visibleMaxY = -Infinity;
  private hiddenMinX = -Infinity;
  private hiddenMinY = -Infinity;
  private hiddenMaxX = Infinity;
  private hiddenMaxY = Infinity;

  /**
   * Copies scalar constraints without retaining caller-owned boxes or witness state.
   *
   * @returns An independent witness.
   */
  copy(): BoundsVisibilityWitness {
    return Object.assign(new BoundsVisibilityWitness(), this);
  }

  /**
   * Adds one candidate's inclusive intersection or one strict separating-axis witness.
   *
   * @param viewport - The viewport used to prepare the candidate.
   * @param bounds - Its placed bounds, including offscreen candidates.
   * @returns Whether the bounds meet the viewport (inclusive), so a caller classifies once.
   */
  observe(viewport: WorldBounds, bounds: WorldBounds): boolean {
    const isVisible = intersectsBounds(viewport, bounds);
    if (!validBounds(viewport) || !validBounds(bounds)) {
      this.isValid = false;
      return isVisible;
    }
    if (isVisible) {
      this.visibleMinX = Math.min(this.visibleMinX, bounds.maxX);
      this.visibleMinY = Math.min(this.visibleMinY, bounds.maxY);
      this.visibleMaxX = Math.max(this.visibleMaxX, bounds.minX);
      this.visibleMaxY = Math.max(this.visibleMaxY, bounds.minY);
    } else if (viewport.maxX < bounds.minX) {
      this.hiddenMaxX = Math.min(this.hiddenMaxX, bounds.minX);
    } else if (viewport.minX > bounds.maxX) {
      this.hiddenMinX = Math.max(this.hiddenMinX, bounds.maxX);
    } else if (viewport.maxY < bounds.minY) {
      this.hiddenMaxY = Math.min(this.hiddenMaxY, bounds.minY);
    } else {
      this.hiddenMinY = Math.max(this.hiddenMinY, bounds.maxY);
    }
    return isVisible;
  }

  /**
   * Proves every observed intersection bit unchanged; a rejected viewport may still be safe.
   *
   * @param viewport - The proposed viewport.
   * @returns Whether all inclusive visible and strict hidden constraints hold.
   */
  accepts(viewport: WorldBounds): boolean {
    return (
      this.isValid &&
      validBounds(viewport) &&
      viewport.minX <= this.visibleMinX &&
      viewport.minY <= this.visibleMinY &&
      viewport.maxX >= this.visibleMaxX &&
      viewport.maxY >= this.visibleMaxY &&
      viewport.minX > this.hiddenMinX &&
      viewport.minY > this.hiddenMinY &&
      viewport.maxX < this.hiddenMaxX &&
      viewport.maxY < this.hiddenMaxY
    );
  }
}

function validBounds(bounds: WorldBounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY) &&
    bounds.minX <= bounds.maxX &&
    bounds.minY <= bounds.maxY
  );
}
