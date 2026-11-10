// An overlay layer for the host tests: a stage after `draw` that records, per frame, the model it
// holds. It accepts only `{ label: string }` models, as a real layer checks what crossed a thread.
import type { GpuBackend } from '../../gpu/gpu-backend.js';
import type { Frame } from '../../scene/frame.js';
import type { EngineOverlay, EngineOverlayFactory } from '../engine-overlay.js';

/** The model the recording overlay accepts. */
export interface RecordedModel {
  /** Any text; the frames record it. */
  readonly label: string;
}

function isRecordedModel(value: unknown): value is RecordedModel {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { label?: unknown }).label === 'string'
  );
}

/** The layer: what each frame drew, and whether it was freed. */
export class RecordingOverlay implements EngineOverlay {
  /** The model's label in each frame, `undefined` before the first model. */
  readonly drawn: (string | undefined)[] = [];
  /** The backend it was created for. */
  readonly backend: GpuBackend;
  /** Whether `destroy` ran. */
  isDestroyed = false;
  private model: RecordedModel | undefined;

  /**
   * Creates the layer.
   *
   * @param backend - The host's backend.
   */
  constructor(backend: GpuBackend) {
    this.backend = backend;
  }

  install(frame: Frame): void {
    frame.insertStage('after', 'draw', {
      name: 'recordingOverlay',
      run: () => {
        this.drawn.push(this.model?.label);
      },
    });
  }

  setModel(model: unknown): boolean {
    if (!isRecordedModel(model)) return false;
    this.model = model;
    return true;
  }

  destroy(): void {
    this.isDestroyed = true;
  }
}

/**
 * A factory that keeps every layer it made.
 *
 * @returns The factory and its layers.
 */
export function recordingOverlays(): {
  create: EngineOverlayFactory;
  layers: RecordingOverlay[];
} {
  const layers: RecordingOverlay[] = [];
  return {
    create: (backend) => {
      const layer = new RecordingOverlay(backend);
      layers.push(layer);
      return layer;
    },
    layers,
  };
}
