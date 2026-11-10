import type { EngineOverlay, EngineOverlayFactory } from './engine-overlay.js';

/**
 * A model meant for one named layer of a layered overlay ({@link layerOverlays}), sent through
 * `EngineHost.setOverlay` like any model. A model without `overlayLayer` goes to the base layer,
 * so the base layer's own models (the selection overlay's) need no wrapper.
 */
export interface OverlayLayerModel {
  /** The layer's name, as given to {@link layerOverlays}. */
  readonly overlayLayer: string;
  /** The layer's own model, which it checks. */
  readonly model: unknown;
}

/**
 * Wraps a model for one named layer of a layered overlay.
 *
 * @param layer - The layer's name.
 * @param model - Its model; plain data, since it may cross to a worker.
 * @returns The wrapped model.
 */
export function overlayLayerModel(layer: string, model: unknown): OverlayLayerModel {
  return { overlayLayer: layer, model };
}

function isOverlayLayerModel(value: unknown): value is OverlayLayerModel {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { overlayLayer?: unknown }).overlayLayer === 'string'
  );
}

/**
 * The layer a model sent to a layered overlay is meant for: its {@link OverlayLayerModel} name,
 * or `''` for the base layer. Pure.
 *
 * @param model - The model as sent.
 * @returns The layer's name; `''` for the base.
 */
export function overlayLayerOf(model: unknown): string {
  return isOverlayLayerModel(model) ? model.overlayLayer : '';
}

/**
 * Combines overlay layers into the one a host takes (`EngineExtensions.createOverlay`), so the
 * app can draw more than the selection overlay over the scene (the trace tint). Each
 * layer installs a transient stage right after `draw`; the base installs first and the named
 * layers after it in listing order, so the base draws over every named layer, and a named layer
 * over those listed after it. A model {@link overlayLayerModel} wrapped goes to its layer (an
 * unknown name is refused, which the host reports as a fault); any other model goes to the base.
 * Runs on the thread that renders.
 *
 * @param base - The base layer's factory: the select tool's overlay.
 * @param layers - The named layers' factories.
 * @returns A factory of the combined layer.
 */
export function layerOverlays(
  base: EngineOverlayFactory,
  layers: Readonly<Record<string, EngineOverlayFactory>>,
): EngineOverlayFactory {
  return (backend) => {
    const baseLayer = base(backend);
    const named = new Map<string, EngineOverlay>(
      Object.entries(layers).map(([name, create]) => [name, create(backend)]),
    );
    return {
      install: (frame) => {
        baseLayer.install(frame);
        for (const layer of named.values()) layer.install(frame);
      },
      setModel: (model) => {
        if (!isOverlayLayerModel(model)) return baseLayer.setModel(model);
        return named.get(model.overlayLayer)?.setModel(model.model) ?? false;
      },
      destroy: () => {
        for (const layer of named.values()) layer.destroy();
        baseLayer.destroy();
      },
    };
  };
}
