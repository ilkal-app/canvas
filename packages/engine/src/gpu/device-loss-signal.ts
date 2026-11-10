import type { GpuDeviceLoss, GpuDeviceLostListener } from './gpu-backend.js';

/**
 * The listeners of one backend's `onDeviceLost`, fired at most once: both backends and the test
 * fakes share it. A listener added after the loss is not called (the owner already knows).
 */
export class DeviceLossSignal {
  private readonly listeners = new Set<GpuDeviceLostListener>();
  private loss: GpuDeviceLoss | undefined;
  private isSilenced = false;

  /**
   * Whether the device was lost.
   *
   * @returns True after {@link DeviceLossSignal.fire}.
   */
  get isLost(): boolean {
    return this.loss !== undefined;
  }

  /**
   * Adds a listener.
   *
   * @param listener - Called with the loss.
   * @returns Removes it.
   */
  add(listener: GpuDeviceLostListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Reports the loss to every listener, once; later calls, and calls after
   * {@link DeviceLossSignal.silence}, do nothing.
   *
   * @param loss - The loss.
   */
  fire(loss: GpuDeviceLoss): void {
    if (this.loss !== undefined || this.isSilenced) return;
    this.loss = loss;
    for (const listener of [...this.listeners]) listener(loss);
    this.listeners.clear();
  }

  /** Stops reporting: the backend is being destroyed on purpose, which is no loss. */
  silence(): void {
    this.isSilenced = true;
    this.listeners.clear();
  }
}
