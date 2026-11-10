import {
  visibleWorldBounds,
  type Camera,
  type PathNetwork,
  type WorldBounds,
  type WorldTransform,
} from '@canvas/engine';
import type { Point } from '@canvas/schema';

import type { ToolCursor } from '../modes/tool-mode.js';
import type { OverlayRect } from '../select/overlay-rects.js';

import {
  hitNetworkHandle,
  hitSegment,
  hitVertex,
  HANDLE_HIT_TOLERANCE_PX,
  SEGMENT_HIT_TOLERANCE_PX,
  VERTEX_HIT_TOLERANCE_PX,
} from './network-hit.js';
import { networkOverlayRects } from './network-overlay.js';
import { NetworkSkeleton } from './network-skeleton.js';

/**
 * What vector edit shows and where: the camera it last saw, the segment under the
 * resting pointer and the cursor over it, and the path's skeleton, kept between overlay rebuilds
 * (`network-skeleton.ts`). It tells the mode when something it shows changed, so the overlay is
 * rebuilt only then: a hover move that changes neither the hovered segment nor the cursor, or a
 * camera move inside the region the skeleton covers, asks for nothing. Main thread; no DOM.
 */
export class VectorEditView {
  /** The camera zoom, CSS px per world unit. */
  zoom = 1;
  /** The segment under the pointer while no button is down. */
  hovered: string | undefined;
  /** The cursor over what is under the pointer while no button is down. */
  hoverCursor: ToolCursor = 'default';
  private camera: Camera | undefined;
  private readonly skeleton = new NetworkSkeleton();

  /**
   * The viewport, when a camera has been seen.
   *
   * @returns The viewport, world units, or `undefined`.
   */
  viewport(): WorldBounds | undefined {
    return this.camera && visibleWorldBounds(this.camera);
  }

  /**
   * Follows the zoom and the camera an input or a camera move brings.
   *
   * @param zoom - The camera zoom now.
   * @param camera - The camera now, when the caller has it.
   * @returns `true` when the overlay must be rebuilt: the zoom changed, or the view left the
   *   region the skeleton was culled to.
   */
  follow(zoom: number, camera: Camera | undefined): boolean {
    const isZoomed = zoom !== this.zoom;
    this.zoom = zoom;
    if (camera !== undefined) this.camera = camera;
    const viewport = this.viewport();
    return isZoomed || (viewport !== undefined && !this.skeleton.covers(viewport));
  }

  /**
   * The pointer with no button down (the prototype's hover): the segment under it is drawn
   * thicker unless a vertex or a shown handle is there too, and the cursor follows what it is
   * on: `pointer` over a vertex or handle, `move` over a segment.
   *
   * @param network - The path's network.
   * @param selected - The selected vertices, whose handles show.
   * @param point - The pointer, local units.
   * @returns `true` when the hovered segment or the cursor changed.
   */
  hover(network: PathNetwork, selected: ReadonlySet<string>, point: Point): boolean {
    const pixel = 1 / this.zoom;
    const isOnPoint =
      hitNetworkHandle(network, selected, point, HANDLE_HIT_TOLERANCE_PX * pixel) !== undefined ||
      hitVertex(network, point, VERTEX_HIT_TOLERANCE_PX * pixel) !== undefined;
    const hovered = isOnPoint
      ? undefined
      : hitSegment(network, point, SEGMENT_HIT_TOLERANCE_PX * pixel)?.segmentId;
    const cursor = isOnPoint ? 'pointer' : hovered === undefined ? 'default' : 'move';
    if (hovered === this.hovered && cursor === this.hoverCursor) return false;
    this.hovered = hovered;
    this.hoverCursor = cursor;
    return true;
  }

  /**
   * The overlay's rectangles: the kept skeleton culled round the viewport, the hovered segment
   * thicker unless a press is under way, the selected vertices' handles and the vertices.
   *
   * @param network - The network shown (a drag's preview while one runs).
   * @param frame - The path's frame in the world.
   * @param selected - The selected vertices.
   * @param isPressing - Whether a press is under way.
   * @returns The rectangles, in drawing order.
   */
  rects(
    network: PathNetwork,
    frame: WorldTransform,
    selected: ReadonlySet<string>,
    isPressing: boolean,
  ): OverlayRect[] {
    const skeleton = this.skeleton.rects(network, frame, this.zoom, this.viewport());
    return networkOverlayRects({
      network,
      frame,
      zoom: this.zoom,
      selected,
      hoveredSegmentId: isPressing ? undefined : this.hovered,
      skeleton,
      // The vertices are culled to the skeleton's region, which a pan stays inside.
      viewport: this.skeleton.region,
    });
  }
}
