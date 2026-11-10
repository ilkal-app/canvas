/** Anything a backend must free when it is destroyed. */
export interface DestroyableResource {
  /** Frees the resource; safe to call once, after which it untracks itself. */
  destroy(): void;
}

/**
 * The live GPU objects a backend created, so `GpuBackend.destroy()` can free what callers did
 * not. WebGL2 needs it: its objects outlive the backend unless deleted, whereas destroying a
 * WebGPU device frees everything created from it. Each resource calls `untrack` from its own
 * `destroy`, so the set holds only live objects.
 */
export class ResourceTracker {
  private readonly live = new Set<DestroyableResource>();

  /**
   * The number of resources not yet destroyed.
   *
   * @returns The live count.
   */
  get liveCount(): number {
    return this.live.size;
  }

  /**
   * Starts tracking a new resource.
   *
   * @param resource - The resource just created.
   */
  track(resource: DestroyableResource): void {
    this.live.add(resource);
  }

  /**
   * Stops tracking a resource the caller destroyed.
   *
   * @param resource - The resource being destroyed.
   */
  untrack(resource: DestroyableResource): void {
    this.live.delete(resource);
  }

  /** Destroys every live resource once. */
  destroyAll(): void {
    for (const resource of [...this.live]) {
      resource.destroy();
    }
    this.live.clear();
  }
}
