import type { MemoryLedger } from '../diagnostics/memory-ledger.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';
import { renderTargetByteLength } from '../gpu/gpu-render-target.js';
import type { GpuRenderTarget, GpuRenderTargetDescriptor } from '../gpu/gpu-render-target.js';

/**
 * The offscreen layers' render targets, by name, charged to the memory ledger: each
 * live target reports its resolved colour (`width × height × 4` bytes) under `layers` while it
 * lives, and gives it back when released. The backend's shared scratch is not charged here.
 * Owned by the thread that owns the backend.
 */
export class LayerTargets {
  private readonly targets = new Map<string, GpuRenderTarget>();

  /**
   * Creates an empty set.
   *
   * @param backend - The backend that makes the targets.
   * @param ledger - Where their bytes are reported.
   */
  constructor(
    private readonly backend: GpuBackend,
    private readonly ledger: MemoryLedger,
  ) {}

  /**
   * How many targets are live.
   *
   * @returns The count.
   */
  get size(): number {
    return this.targets.size;
  }

  /**
   * The named target at a size: the live one when its size matches, else a new one replacing it.
   *
   * @param name - The owner's name for it, unique in this set (a layer's object id).
   * @param size - Its size in device pixels.
   * @returns The target.
   * @throws {RangeError} When the size is out of the backend's range.
   */
  acquire(name: string, size: GpuRenderTargetDescriptor): GpuRenderTarget {
    const current = this.targets.get(name);
    if (current?.width === size.width && current.height === size.height) {
      return current;
    }
    const target = this.backend.createRenderTarget(size);
    this.release(name);
    this.targets.set(name, target);
    this.ledger.set('layers', name, renderTargetByteLength(target));
    return target;
  }

  /**
   * Destroys the named target and gives back its bytes; an unknown name does nothing.
   *
   * @param name - The name given to `acquire`.
   */
  release(name: string): void {
    const target = this.targets.get(name);
    if (target === undefined) return;
    this.targets.delete(name);
    target.destroy();
    this.ledger.delete('layers', name);
  }

  /** Releases every target: when the layers are gone, or the backend is replaced. */
  releaseAll(): void {
    for (const name of [...this.targets.keys()]) this.release(name);
  }
}
