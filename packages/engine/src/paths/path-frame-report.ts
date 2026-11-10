/** What the path pass did to prepare one frame's meshes (`PathPassOptions.onFrame`). */
export interface PathFrameReport {
  /** The frame's zoom bucket. */
  readonly bucket: number;
  /** Paths with a mesh to draw this frame (exact or stand-in). */
  readonly pathsDrawn: number;
  /** Meshes built and uploaded during the frame (by an inline builder). */
  readonly meshesBuilt: number;
  /** Paths drawn with a stand-in (another bucket or an older version) while theirs is built. */
  readonly standIns: number;
  /** Path segments sent for meshing this frame. */
  readonly segmentsSent: number;
  /** Of them, the segments meshed in the frame itself (`isMeshedInline`). */
  readonly segmentsInline: number;
  /** The live stroke's pieces meshed in the frame first (`isLiveStroke`), segments; 0 for none. */
  readonly prioritySegments: number;
  /** Builds in flight after the frame (a pool builder's). */
  readonly pendingMeshes: number;
  /** The mesh cache's GPU bytes after the frame. */
  readonly meshBytes: number;
  /** Meshes the cache evicted for its budget, since the drawer was created. */
  readonly evictions: number;
}

/** What the cache reports at a frame's end. */
interface CacheReading {
  readonly byteLength: number;
  readonly evictions: number;
}

/** The counters one frame's mesh preparation fills in. */
export class PathFrameCounts {
  /** Meshes built and uploaded. */
  meshesBuilt = 0;
  /** Paths drawn with a stand-in. */
  standIns = 0;
  /** Path segments sent for meshing. */
  segmentsSent = 0;
  /** Of them, the segments meshed in the frame itself. */
  segmentsInline = 0;
  /** The live stroke meshed in the frame's priority slot, segments; 0 for none. */
  prioritySegments = 0;

  /** Zeroes every counter for a new frame. */
  reset(): void {
    this.meshesBuilt = 0;
    this.standIns = 0;
    this.segmentsSent = 0;
    this.segmentsInline = 0;
    this.prioritySegments = 0;
  }

  /**
   * The frame's report.
   *
   * @param bucket - The frame's zoom bucket.
   * @param pathsDrawn - Paths with a mesh to draw.
   * @param cache - The mesh cache after the frame.
   * @param pendingMeshes - Builds in flight.
   * @returns The report.
   */
  report(
    bucket: number,
    pathsDrawn: number,
    cache: CacheReading,
    pendingMeshes: number,
  ): PathFrameReport {
    return {
      bucket,
      pathsDrawn,
      meshesBuilt: this.meshesBuilt,
      standIns: this.standIns,
      segmentsSent: this.segmentsSent,
      segmentsInline: this.segmentsInline,
      prioritySegments: this.prioritySegments,
      pendingMeshes,
      meshBytes: cache.byteLength,
      evictions: cache.evictions,
    };
  }
}
