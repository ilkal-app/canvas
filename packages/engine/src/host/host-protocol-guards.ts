// The message checks of the host protocol (`host-protocol.ts`), re-exported from there: each
// side checks the shape of every message it receives from the other thread.
import {
  hasFields,
  isCamera,
  isColor,
  isFailure,
  isNumber,
  isPointer,
  isRecord,
  isRect,
  type Check,
} from './host-protocol-checks.js';
import type { EngineCommand, HostToWorkerMessage, WorkerToHostMessage } from './host-protocol.js';
import { isEngineInputsCompleted, isInputMark } from './input-marks.js';
import { isSceneStamp, isPreviewRequest, isPreviewCertificate } from './scene-certificate.js';
import { isStickyAuthorNames } from './sticky-author-messages.js';
import { isTransferStamps } from './transfer-stamps.js';

/** Each command's fields and their checks. */
const COMMAND_FIELDS: Readonly<Record<EngineCommand['type'], Readonly<Record<string, Check>>>> = {
  // A change set's lists are checked where the change is applied, in the frame's timed
  // `applyChanges` stage (`isSerializableChangeSet`), so a large board's check is measured.
  'change-set': { changes: isRecord, stamp: (value) => value === undefined || isSceneStamp(value) },
  'read-preview-certificate': { id: isNumber, request: isPreviewRequest },
  // The overlay layer checks its own model; the engine does not know its shape.
  overlay: { model: (model) => model !== undefined },
  grid: { isVisible: (value) => typeof value === 'boolean' },
  theme: {
    theme: (value) => value === 'light' || value === 'dark',
    inkColors: (value) =>
      value === undefined || hasFields(value, { light: isColor, dark: isColor }),
  },
  tokens: {
    tokens: (value) =>
      Array.isArray(value) &&
      value.every((token) =>
        hasFields(token, { id: (id) => typeof id === 'string', light: isColor, dark: isColor }),
      ),
  },
  stickyAuthors: {
    isShown: (value) => typeof value === 'boolean',
    names: isStickyAuthorNames,
    fallback: (value) => typeof value === 'string',
  },
  camera: { camera: isCamera },
  'animate-camera': { camera: isCamera, durationMs: isNumber },
  pointer: { input: isPointer },
  resize: { widthPx: isNumber, heightPx: isNumber, dpr: isNumber },
  'request-frame': {},
  'acknowledge-frame': { id: (id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0 },
  'read-pixels': { id: isNumber, rect: isRect },
  'read-projection': {
    id: isNumber,
    bounds: (value) =>
      hasFields(value, { minX: isNumber, minY: isNumber, maxX: isNumber, maxY: isNumber }),
  },
  'mark-input': { mark: isInputMark },
  'start-frame-stats': { capacity: isNumber },
  'read-frame-stats': { id: isNumber },
  'stop-frame-stats': {},
  'lose-device': {},
};

function isCommand(value: unknown): value is EngineCommand {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (!Object.hasOwn(COMMAND_FIELDS, value.type)) return false;
  return hasFields(value, COMMAND_FIELDS[value.type as EngineCommand['type']]);
}

/**
 * Checks a message received by the engine worker: its type and the shape of every field. Board
 * objects inside a change set are the document's, already validated there, and are not
 * re-checked.
 *
 * @param value - The received message data.
 * @returns `true` when `value` is a well-formed {@link HostToWorkerMessage}.
 */
export function isHostToWorkerMessage(value: unknown): value is HostToWorkerMessage {
  if (!isRecord(value)) return false;
  if (value.type === 'engine-fallback-canvas')
    return value.canvas === undefined || isRecord(value.canvas);
  if (value.type === 'engine-frame-tick') return true;
  if (value.type === 'engine-init') {
    return (
      hasFields(value, { canvas: isRecord, options: isRecord }) &&
      (value.imageChannel === undefined || isRecord(value.imageChannel))
    );
  }
  return (
    value.type === 'engine-commands' &&
    (value.postedMs === undefined || isNumber(value.postedMs)) &&
    Array.isArray(value.commands) &&
    value.commands.every(isCommand)
  );
}

/**
 * Checks a message received from the engine worker: its type and fields. Reports and
 * capabilities are trusted to be what the worker, which runs this package, produced.
 *
 * @param value - The received message data.
 * @returns `true` when `value` is a well-formed {@link WorkerToHostMessage}.
 */
export function isWorkerToHostMessage(value: unknown): value is WorkerToHostMessage {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'engine-ready':
      return hasFields(value, { capabilities: isRecord, timeOriginMs: isNumber });
    case 'engine-frame':
      return (
        hasFields(value, { report: isRecord }) &&
        (value.transfer === undefined || isTransferStamps(value.transfer))
      );
    case 'engine-inputs-completed':
      return isEngineInputsCompleted(value.completion);
    case 'engine-preview-certificate':
      return hasFields(value, {
        id: isNumber,
        certificate: (item) => item === undefined || isPreviewCertificate(item),
      });
    case 'engine-projection':
      return hasFields(value, {
        id: isNumber,
        projection: (item) => item === undefined || isRecord(item),
      });
    case 'engine-pixels':
      return hasFields(value, { id: isNumber, pixels: isRecord });
    case 'engine-frame-stats':
      return hasFields(value, { id: isNumber, sample: isRecord });
    case 'engine-needs-canvas':
    case 'engine-needs-frame-tick':
      return true;
    case 'engine-backend-changed':
      return hasFields(value, { capabilities: isRecord });
    case 'engine-failure':
      return isFailure(value.failure) && (value.id === undefined || isNumber(value.id));
    default:
      return false;
  }
}
