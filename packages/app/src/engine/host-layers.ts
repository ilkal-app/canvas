import type { HostView } from './host-view.js';

/**
 * The latest model of each named overlay layer a mount shows (the trace tint; peers
 * editing), kept so that a host that starts later, or a remount's new view, is sent
 * them at once. Main thread.
 */
export class HostLayers {
  private readonly models = new Map<string, unknown>();
  private view: Pick<HostView, 'showLayer'> | undefined;

  /**
   * Shows a model on a layer: now if a view is attached, and on every view attached later.
   *
   * @param layer - The layer's name in the shell's overlay.
   * @param model - Its model, plain data.
   */
  show(layer: string, model: unknown): void {
    this.models.set(layer, model);
    this.view?.showLayer(layer, model);
  }

  /**
   * A function that shows models on one layer (`MountedEngine.showTraceTint`).
   *
   * @param layer - The layer's name in the shell's overlay.
   * @returns The function: each model it is given is shown as {@link HostLayers.show} does.
   */
  setter(layer: string): (model: unknown) => void {
    return (model) => {
      this.show(layer, model);
    };
  }

  /**
   * Sends the view every layer's latest model, and every later one.
   *
   * @param view - The running host's view.
   */
  attach(view: Pick<HostView, 'showLayer'>): void {
    this.view = view;
    for (const [layer, model] of this.models) view.showLayer(layer, model);
  }
}
