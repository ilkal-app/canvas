/**
 * The message protocol between the worker engine host on the page and the engine worker, in the
 * conventions of the job protocol (`../workers/protocol.ts`): plain structured-cloneable messages
 * discriminated by `type`, transfer lists for buffers and the canvas, failures as cloneable
 * `{ name, message }` data, and both sides checking what they receive, since a message that crossed
 * a thread is untrusted.
 *
 * The exchange:
 *
 * 1. The page posts `engine-init` with the `OffscreenCanvas` (transferred), the options and,
 *    optionally, the page's opaque image channel (transferred). The
 *    worker creates its backend and runtime and answers `engine-ready` with the backend's
 *    capabilities and its clock origin, or `engine-failure` without an id.
 * 2. The page posts `engine-commands`: every call made in one task, in order, as one message,
 *    so they reach the worker together and land in one frame.
 * 3. The worker posts `engine-frame` after each frame, and `engine-inputs-completed` once the GPU
 *    finished a frame that carried `mark-input` commands; `engine-pixels` (the buffer transferred)
 *    or `engine-failure` with the read's id for each `read-pixels`; `engine-frame-stats` or
 *    `engine-failure` with the read's id for each `read-frame-stats`; `engine-failure` without
 *    an id for a frame that threw or a message it could not use.
 * 4. After a WebGPU device loss the worker posts `engine-needs-canvas`; the page lays a fresh
 *    canvas over its own and posts `engine-fallback-canvas` with that canvas's `OffscreenCanvas`
 *    (transferred); the worker draws on it with WebGL2 and posts `engine-backend-changed`.
 */
import type { InkTheme } from '@canvas/schema';

import type { Camera, WorldBounds } from '../camera/camera.js';
import type { BenchmarkSample } from '../diagnostics/stats-export.js';
import type { GpuCapabilities } from '../gpu/gpu-capabilities.js';
import type { InkColors } from '../paint/color-palette.js';

import type { SerializableColorToken } from './color-token-messages.js';
import type { EngineCanvas } from './engine-host-platform.js';
import type { EngineFrameReport, EngineHostOptions } from './engine-host.js';
import type { EnginePixels, PixelRect } from './engine-pixels.js';
import type { HostFailure } from './host-failure.js';
import type { EngineInputsCompleted, InputMark } from './input-marks.js';
import type { PointerInput } from './pointer-input.js';
import type { SceneStamp, PreviewRequest, PreviewCertificate } from './scene-certificate.js';
import type { SceneProjection } from './scene-projection.js';
import type { SerializableChangeSet } from './serializable-change-set.js';
import type { SerializableStickyAuthors } from './sticky-author-messages.js';
import type { EngineTransferStamps } from './transfer-stamps.js';

/** One `EngineHost` call, as the worker replays it. */
export type EngineCommand =
  | {
      /** Reads complete preview proof after a successful frame barrier. */
      readonly type: 'read-preview-certificate';
      /** Correlates the certificate reply. */
      readonly id: number;
      /** Exact scene, camera and resource coverage requested. */
      readonly request: PreviewRequest;
    }
  | {
      /** Reads candidates after the next frame. */
      readonly type: 'read-projection';
      /** Correlates its reply. */
      readonly id: number;
      /** World-space coverage. */
      readonly bounds: WorldBounds;
    }
  | {
      /** `applyChangeSet`. */
      readonly type: 'change-set';
      /** The change. */
      readonly changes: SerializableChangeSet;
      /** Optional exact scene stream identity. */
      readonly stamp?: SceneStamp;
    }
  | {
      /** `setOverlay`. */
      readonly type: 'overlay';
      /** The model, checked by the worker's overlay layer. */
      readonly model: unknown;
    }
  | {
      /** `setGridVisible`. */
      readonly type: 'grid';
      /** Whether the grid shows. */
      readonly isVisible: boolean;
    }
  | {
      /** `setTheme`. */
      readonly type: 'theme';
      /** The viewer's theme. */
      readonly theme: InkTheme;
      /** What ink draws as per theme, when it changed. */
      readonly inkColors?: InkColors;
    }
  | {
      /** `setColorTokens`: the whole table (`serializeColorTokens`). */
      readonly type: 'tokens';
      /** Each token's id and light and dark values. */
      readonly tokens: readonly SerializableColorToken[];
    }
  | ({
      /** `setStickyAuthors`: the board's authors whole (`serializeStickyAuthors`). */
      readonly type: 'stickyAuthors';
    } & SerializableStickyAuthors)
  | {
      /** `setCamera`. */
      readonly type: 'camera';
      /** The camera. */
      readonly camera: Camera;
    }
  | {
      /** `animateCamera`. */
      readonly type: 'animate-camera';
      /** Where the camera ends. */
      readonly camera: Camera;
      /** How long the move takes, ms. */
      readonly durationMs: number;
    }
  | {
      /** `pointer`. */
      readonly type: 'pointer';
      /** The pointer input. */
      readonly input: PointerInput;
    }
  | {
      /** `resize`. */
      readonly type: 'resize';
      /** Drawing buffer width, device px. */
      readonly widthPx: number;
      /** Drawing buffer height, device px. */
      readonly heightPx: number;
      /** Device pixels per CSS pixel. */
      readonly dpr: number;
    }
  | {
      /** `requestFrame`. */
      readonly type: 'request-frame';
    }
  | {
      /** Ordered request for a successfully rendered frame. */
      readonly type: 'acknowledge-frame';
      /** Positive safe integer, never reused during the host lifetime. */
      readonly id: number;
    }
  | {
      /** `readPixels`. */
      readonly type: 'read-pixels';
      /** Correlates the answer with the read. */
      readonly id: number;
      /** The rectangle, device px. */
      readonly rect: PixelRect;
    }
  | {
      /** `markInput`: completes with the frame that takes the commands before it. */
      readonly type: 'mark-input';
      /** The mark, returned unchanged in `engine-inputs-completed`. */
      readonly mark: InputMark;
    }
  | {
      /** `startFrameStats`. */
      readonly type: 'start-frame-stats';
      /** Frames the history keeps. */
      readonly capacity: number;
    }
  | {
      /** `readFrameStats`. */
      readonly type: 'read-frame-stats';
      /** Correlates the answer with the read. */
      readonly id: number;
    }
  | {
      /** `stopFrameStats`. */
      readonly type: 'stop-frame-stats';
    }
  | {
      /** `loseDeviceForTesting`: loses the GPU device, as a driver reset would. */
      readonly type: 'lose-device';
    };

/** Starts the engine in the worker. */
export interface EngineInitMessage {
  /** Discriminates the message. */
  readonly type: 'engine-init';
  /** The `OffscreenCanvas` the page handed over; in the message's transfer list. */
  readonly canvas: EngineCanvas;
  /** How to render. */
  readonly options: EngineHostOptions;
  /**
   * An opaque transferable the page gives its image support (the app's `MessagePort` to its
   * assets), in the message's transfer list; the worker hands it to its script's
   * `createImages` and never reads it.
   */
  readonly imageChannel?: object;
}

/** The calls the page made in one task, in order. */
export interface EngineCommandsMessage {
  /** Discriminates the message. */
  readonly type: 'engine-commands';
  /** The calls. */
  readonly commands: readonly EngineCommand[];
  /**
   * When the page posted the batch, ms on the page's clock; only while frame statistics record
   * (transfer timers), so the worker can time the hop to it.
   */
  readonly postedMs?: number;
}

/**
 * The answer to `engine-needs-canvas`: the `OffscreenCanvas` of a page canvas laid over
 * the original, in the message's transfer list, or none when the page cannot lay one.
 */
export interface EngineFallbackCanvasMessage {
  /** Discriminates the message. */
  readonly type: 'engine-fallback-canvas';
  /** The fallback canvas's `OffscreenCanvas`; transferred. Absent: retry WebGPU in place. */
  readonly canvas?: EngineCanvas;
}

/**
 * The answer to `engine-needs-frame-tick`: the page's animation frame came, so the
 * worker, whose scope has none, runs the frames it requested.
 */
export interface EngineFrameTickMessage {
  /** Discriminates the message. */
  readonly type: 'engine-frame-tick';
}

/** What the page posts to the engine worker. */
export type HostToWorkerMessage =
  EngineInitMessage | EngineCommandsMessage | EngineFallbackCanvasMessage | EngineFrameTickMessage;

/** What the engine worker posts to the page. */
export type WorkerToHostMessage =
  | {
      /** The result of a frame-barrier preview proof request. */
      readonly type: 'engine-preview-certificate';
      /** Correlates the originating request. */
      readonly id: number;
      /** Complete proof, or undefined while any contributor is unproven. */
      readonly certificate: PreviewCertificate | undefined;
    }
  | {
      /** A frame-barrier candidate read. */
      readonly type: 'engine-projection';
      /** Correlates its request. */
      readonly id: number;
      /** Absent without a camera/spatial index. */
      readonly projection: SceneProjection | undefined;
    }
  | {
      /** The engine runs: the answer to `engine-init`. */
      readonly type: 'engine-ready';
      /** The worker's backend. */
      readonly capabilities: GpuCapabilities;
      /** The worker's `performance.timeOrigin`, ms since the epoch. */
      readonly timeOriginMs: number;
    }
  | {
      /** A frame was drawn. */
      readonly type: 'engine-frame';
      /** Its report, `frameTimeMs` on the worker's clock. */
      readonly report: EngineFrameReport;
      /** The latest stamped batch before the frame, while frame statistics record. */
      readonly transfer?: EngineTransferStamps;
    }
  | {
      /** A frame's input marks, once the GPU finished its work. */
      readonly type: 'engine-inputs-completed';
      /** The marks; times on the worker's clock. */
      readonly completion: EngineInputsCompleted;
    }
  | {
      /** A read's pixels; the buffer is transferred. */
      readonly type: 'engine-pixels';
      /** The read's id. */
      readonly id: number;
      /** The pixels. */
      readonly pixels: EnginePixels;
    }
  | {
      /** A statistics read's summary. */
      readonly type: 'engine-frame-stats';
      /** The read's id. */
      readonly id: number;
      /** The frame statistics. */
      readonly sample: BenchmarkSample;
    }
  | {
      /**
       * The WebGPU device was lost, and a canvas that had a WebGPU context can never have a
       * WebGL2 one: the page answers with `engine-fallback-canvas`.
       */
      readonly type: 'engine-needs-canvas';
    }
  | {
      /**
       * The worker's scope has no animation frames and it wants one: the page answers with
       * `engine-frame-tick` at its next animation frame.
       */
      readonly type: 'engine-needs-frame-tick';
    }
  | {
      /** The engine switched backend mid-session, drawing on the fallback canvas. */
      readonly type: 'engine-backend-changed';
      /** The new backend. */
      readonly capabilities: GpuCapabilities;
    }
  | {
      /** Something failed. */
      readonly type: 'engine-failure';
      /** The read (of pixels or statistics) that failed; absent for a failure of the engine as a whole. */
      readonly id?: number;
      /** What went wrong. */
      readonly failure: HostFailure;
    };

export { describeHostFailure, toHostError } from './host-failure.js';
export type { HostFailure } from './host-failure.js';

export { isHostToWorkerMessage, isWorkerToHostMessage } from './host-protocol-guards.js';
