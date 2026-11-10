import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { TransferList } from '../workers/protocol.js';

import { backendOptionsOf } from './backend-options.js';
import { switchingBackendFactory } from './backend-switch.js';
import { deserializeColorTokens } from './color-token-messages.js';
import type { EngineExtensions, EngineImageSupport } from './engine-extensions.js';
import type { EngineCanvas, EngineThreadPlatform } from './engine-host-platform.js';
import type { EngineFrameReport } from './engine-host.js';
import { EngineRuntime } from './engine-runtime.js';
import {
  describeHostFailure,
  isHostToWorkerMessage,
  type EngineCommand,
  type EngineInitMessage,
  type WorkerToHostMessage,
} from './host-protocol.js';
import type { EngineInputsCompleted } from './input-marks.js';
import { withPageFrameTicks } from './page-frame-ticks.js';
import { deserializeStickyAuthors } from './sticky-author-messages.js';
import type { EngineTransferStamps } from './transfer-stamps.js';

/**
 * Posts one message from the engine worker; throws as `postMessage` does (a `DataCloneError`).
 *
 * @param message - The structured-cloneable message.
 * @param transfer - Objects to transfer rather than copy.
 */
export type EngineWorkerPoster = (message: unknown, transfer: TransferList) => void;

/**
 * The engine worker's side of the host protocol (`host-protocol.ts`), DOM-free. It has the
 * shape of the job protocol's worker entry, so `serveWorkerEntry` binds it to a real worker:
 * the engine worker's whole script is
 * `serveWorkerEntry(self, createEngineWorkerEntry(createBrowserHostPlatform(self)))`.
 */
export interface EngineWorkerEntry {
  /**
   * Handles one message from the page.
   *
   * @param data - The message data.
   * @param post - Posts to the page.
   * @returns Settles once the message is handled (after the backend exists, for `engine-init`).
   */
  onMessage(data: unknown, post: EngineWorkerPoster): Promise<void>;
  /**
   * Handles a message that could not be deserialised, by reporting it to the page.
   *
   * @param post - Posts to the page.
   */
  onMessageError(post: EngineWorkerPoster): void;
}

function send(post: EngineWorkerPoster, message: WorkerToHostMessage, transfer: TransferList = []) {
  post(message, transfer);
}

function sendFailure(post: EngineWorkerPoster, error: unknown, id?: number): void {
  const failure = describeHostFailure(error);
  send(
    post,
    id === undefined
      ? { type: 'engine-failure', failure }
      : { type: 'engine-failure', id, failure },
  );
}

/**
 * Answers one read with its pixels, transferring the buffer, or with a failure for its id when
 * the read or the post fails.
 *
 * @param runtime - The engine.
 * @param command - The read.
 * @param post - Posts to the page.
 */
function answerRead(
  runtime: EngineRuntime,
  command: Extract<EngineCommand, { type: 'read-pixels' }>,
  post: EngineWorkerPoster,
): void {
  const { id } = command;
  runtime.readPixels(command.rect).then(
    (pixels) => {
      try {
        send(post, { type: 'engine-pixels', id, pixels }, [pixels.rgba.buffer]);
      } catch (error) {
        sendFailure(post, error, id);
      }
    },
    (error: unknown) => {
      sendFailure(post, error, id);
    },
  );
}

/**
 * Answers one statistics read with the runtime's summary, or with a failure for its id.
 *
 * @param runtime - The engine.
 * @param id - The read's id.
 * @param post - Posts to the page.
 */
function answerStatsRead(runtime: EngineRuntime, id: number, post: EngineWorkerPoster): void {
  try {
    send(post, { type: 'engine-frame-stats', id, sample: runtime.readFrameStats() });
  } catch (error) {
    sendFailure(post, error, id);
  }
}

function answerCertificate(
  runtime: EngineRuntime,
  command: Extract<EngineCommand, { type: 'read-preview-certificate' }>,
  post: EngineWorkerPoster,
): void {
  runtime.readPreviewCertificate(command.request).then(
    (certificate) => {
      try {
        send(post, { type: 'engine-preview-certificate', id: command.id, certificate });
      } catch (error) {
        sendFailure(post, error, command.id);
      }
    },
    (error: unknown) => {
      sendFailure(post, error, command.id);
    },
  );
}

function replay(
  runtime: EngineRuntime,
  command: EngineCommand,
  post: EngineWorkerPoster,
  device: WorkerDevice,
): void {
  switch (command.type) {
    case 'change-set':
      runtime.applyChangeSet(command.changes, command.stamp);
      return;
    case 'overlay':
      runtime.setOverlay(command.model);
      return;
    case 'grid':
      runtime.view.setGridVisible(command.isVisible);
      return;
    case 'theme':
      runtime.view.setTheme(command.theme, command.inkColors);
      return;
    case 'tokens':
      runtime.view.setColorTokens(deserializeColorTokens(command.tokens));
      return;
    case 'stickyAuthors':
      runtime.view.setStickyAuthors(deserializeStickyAuthors(command));
      return;
    case 'camera':
      runtime.setCamera(command.camera);
      return;
    case 'animate-camera':
      runtime.animateCamera(command.camera, command.durationMs);
      return;
    case 'pointer':
      runtime.pointer(command.input);
      return;
    case 'resize':
      runtime.resize(command.widthPx, command.heightPx, command.dpr);
      return;
    case 'acknowledge-frame':
      runtime.markFrameAcknowledgement(command.id);
      return;
    case 'request-frame':
      runtime.requestFrame();
      return;
    case 'read-preview-certificate':
      answerCertificate(runtime, command, post);
      return;
    case 'read-projection':
      runtime.readProjection(command.bounds).then(
        (projection) => {
          try {
            send(post, { type: 'engine-projection', id: command.id, projection });
          } catch (error) {
            sendFailure(post, error, command.id);
          }
        },
        (error: unknown) => {
          sendFailure(post, error, command.id);
        },
      );
      return;
    case 'read-pixels':
      answerRead(runtime, command, post);
      return;
    case 'start-frame-stats':
      runtime.startFrameStats(command.capacity);
      return;
    case 'read-frame-stats':
      answerStatsRead(runtime, command.id, post);
      return;
    case 'mark-input':
      runtime.markInput(command.mark);
      return;
    case 'stop-frame-stats':
      runtime.stopFrameStats();
      return;
    case 'lose-device':
      device.backend?.loseDeviceForTesting?.();
  }
}

/** The transfer timers' stamps of the latest stamped batch, until a frame report carries them. */
interface PendingTransfer {
  stamps: Omit<EngineTransferStamps, 'sentMs'> | undefined;
}

/** The worker's GPU device: its backend, and the fallback canvas it waits for. */
interface WorkerDevice {
  /** The backend the engine draws with; rebuilt after a loss. */
  backend: GpuBackend | undefined;
  /** Takes the canvas `engine-fallback-canvas` brings, while the worker waits for one. */
  receive: ((canvas: EngineCanvas | undefined) => void) | undefined;
}

/**
 * Asks the page for a fresh canvas after a WebGPU loss.
 *
 * @param post - Posts to the page.
 * @param device - Where the page's answer is delivered.
 * @returns The fallback canvas's `OffscreenCanvas`, or `undefined` when the page has none.
 */
function requestFallbackCanvas(
  post: EngineWorkerPoster,
  device: WorkerDevice,
): Promise<EngineCanvas | undefined> {
  return new Promise((resolve) => {
    device.receive = resolve;
    send(post, { type: 'engine-needs-canvas' });
  });
}

async function start(
  platform: EngineThreadPlatform,
  message: EngineInitMessage,
  post: EngineWorkerPoster,
  extensions: EngineWorkerExtensions,
  transfer: PendingTransfer,
  device: WorkerDevice,
): Promise<EngineRuntime> {
  const { canvas, options, imageChannel } = message;
  const { createImages, ...shared } = extensions;
  const backendOptions = backendOptionsOf(options);
  const backend = await platform.createBackend(canvas, backendOptions);
  device.backend = backend;
  // After a WebGPU loss the engine draws on a fresh canvas the page lays over its own.
  const recreateBackend = switchingBackendFactory(
    platform,
    canvas,
    backendOptions,
    () => requestFallbackCanvas(post, device),
    (rebuilt, isSwitch) => {
      device.backend = rebuilt;
      if (isSwitch)
        send(post, { type: 'engine-backend-changed', capabilities: rebuilt.capabilities });
    },
  );
  // Created once the backend exists, so a start that fails opens no asset source to leak.
  const images = createImages?.(imageChannel) ?? shared.images;
  const callbacks = {
    onFrame: (report: EngineFrameReport) => {
      const { stamps } = transfer;
      transfer.stamps = undefined;
      send(post, {
        type: 'engine-frame',
        report,
        ...(stamps && { transfer: { ...stamps, sentMs: platform.now() } }),
      });
    },
    onFault: (error: Error) => {
      sendFailure(post, error);
    },
    onInputsCompleted: (completion: EngineInputsCompleted) => {
      send(post, { type: 'engine-inputs-completed', completion });
    },
  };
  const runtime = new EngineRuntime(
    backend,
    canvas,
    platform,
    options,
    callbacks,
    {
      ...shared,
      ...(images === undefined ? {} : { images }),
      recreateBackend,
    },
    true,
  );
  send(post, {
    type: 'engine-ready',
    capabilities: backend.capabilities,
    timeOriginMs: platform.timeOriginMs,
  });
  return runtime;
}

/**
 * What the engine worker's script adds to the engine: code, which no message can carry (the
 * selection overlay layer, the text pass's fonts, the image assets, the job workers the engine's
 * pool starts from this worker).
 */
export interface EngineWorkerExtensions extends EngineExtensions {
  /**
   * Creates the image support once the engine starts, from the opaque channel the page sent
   * with `engine-init` (`CreateEngineHostOptions.imageChannel`: the app's `MessagePort` to its
   * assets), or `undefined` when it sent none. Used instead of `images` when given.
   */
  readonly createImages?: (imageChannel: object | undefined) => EngineImageSupport;
}

/**
 * Creates the engine worker's side of the host protocol: on `engine-init` it creates the backend
 * for the transferred canvas and an `EngineRuntime`, then replays every command the page
 * sends, in order, and posts each frame's report and each read's pixels back. The page's clock
 * never reaches the worker: reports carry the worker's frame times, which the page converts. A
 * command that fails (a bad resize) is reported and the rest of its batch still runs.
 *
 * @param platform - The worker's platform (`createBrowserHostPlatform(self)`).
 * @param extensions - The overlay layer the worker draws the page's models with, the text
 *   pass's resources and the job workers its pool starts, if any.
 * @returns The entry, for `serveWorkerEntry`.
 */
export function createEngineWorkerEntry(
  platform: EngineThreadPlatform,
  extensions: EngineWorkerExtensions = {},
): EngineWorkerEntry {
  let runtime: EngineRuntime | undefined;
  let isStarted = false;
  // Without animation frames in this scope, frames come from the page's ticks.
  const framed = withPageFrameTicks(platform);
  const transfer: PendingTransfer = { stamps: undefined };
  const device: WorkerDevice = { backend: undefined, receive: undefined };
  return {
    async onMessage(data, post) {
      if (!isHostToWorkerMessage(data)) {
        sendFailure(post, new TypeError('The engine worker received a malformed message.'));
        return;
      }
      if (data.type === 'engine-init') {
        if (isStarted) {
          sendFailure(post, new Error('The engine worker was started twice.'));
          return;
        }
        isStarted = true;
        framed.ticks?.connect(() => {
          send(post, { type: 'engine-needs-frame-tick' });
        });
        try {
          runtime = await start(framed.platform, data, post, extensions, transfer, device);
        } catch (error) {
          sendFailure(post, error);
        }
        return;
      }
      if (data.type === 'engine-frame-tick') {
        framed.ticks?.tick(platform.now());
        return;
      }
      if (data.type === 'engine-fallback-canvas') {
        const { receive } = device;
        device.receive = undefined;
        if (receive === undefined)
          sendFailure(post, new Error('The engine worker received a canvas it did not ask for.'));
        else receive(data.canvas);
        return;
      }
      if (runtime === undefined) {
        sendFailure(post, new Error('The engine worker received commands before it started.'));
        return;
      }
      const { postedMs } = data;
      if (postedMs !== undefined) transfer.stamps = { postedMs, receivedMs: platform.now() };
      for (const command of data.commands) {
        try {
          replay(runtime, command, post, device);
        } catch (error) {
          sendFailure(post, error);
        }
      }
    },
    onMessageError(post) {
      sendFailure(post, new Error('A message to the engine worker could not be deserialised.'));
    },
  };
}
