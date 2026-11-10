import { describe, expect, it } from 'vitest';

import {
  describeHostFailure,
  isHostToWorkerMessage,
  isWorkerToHostMessage,
  toHostError,
  type EngineCommand,
} from './host-protocol.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 4, viewportHeightPx: 2, dpr: 1 };

const COMMANDS: readonly EngineCommand[] = [
  { type: 'change-set', changes: { created: [], updated: [], deleted: [], objects: {} } },
  { type: 'overlay', model: { frame: null } },
  { type: 'camera', camera: CAMERA },
  { type: 'animate-camera', camera: CAMERA, durationMs: 100 },
  {
    type: 'pointer',
    input: { type: 'move', xPx: 1, yPx: 2, buttons: 0, pointerId: 1, timestampMs: 3 },
  },
  { type: 'resize', widthPx: 4, heightPx: 2, dpr: 1 },
  { type: 'request-frame' },
  { type: 'read-pixels', id: 1, rect: { xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 } },
  { type: 'start-frame-stats', capacity: 240 },
  { type: 'read-frame-stats', id: 2 },
  { type: 'stop-frame-stats' },
  { type: 'grid', isVisible: true },
  { type: 'lose-device' },
];

describe('isHostToWorkerMessage', () => {
  it('accepts an init message and a batch of every command', () => {
    expect(isHostToWorkerMessage({ type: 'engine-init', canvas: {}, options: {} })).toBe(true);
    expect(isHostToWorkerMessage({ type: 'engine-commands', commands: COMMANDS })).toBe(true);
  });

  it('accepts a fallback canvas, or none, and rejects a canvas that is not an object', () => {
    expect(isHostToWorkerMessage({ type: 'engine-fallback-canvas', canvas: {} })).toBe(true);
    expect(isHostToWorkerMessage({ type: 'engine-fallback-canvas' })).toBe(true);
    expect(isHostToWorkerMessage({ type: 'engine-fallback-canvas', canvas: 7 })).toBe(false);
    expect(isHostToWorkerMessage({ type: 'engine-frame-tick' })).toBe(true);
  });

  it('rejects unknown types, unknown commands and commands with malformed fields', () => {
    for (const message of [
      null,
      'engine-init',
      { type: 'engine-start' },
      { type: 'engine-init', options: {} },
      { type: 'engine-commands', commands: 'camera' },
      { type: 'engine-commands', commands: [{ type: 'fly' }] },
      { type: 'engine-commands', commands: [{ type: 'toString' }] },
      { type: 'engine-commands', commands: [{ type: 'camera', camera: { ...CAMERA, zoom: NaN } }] },
      { type: 'engine-commands', commands: [{ type: 'resize', widthPx: 4, heightPx: 2 }] },
      { type: 'engine-commands', commands: [{ type: 'start-frame-stats' }] },
      { type: 'engine-commands', commands: [{ type: 'read-frame-stats', id: '2' }] },
      { type: 'engine-commands', commands: [{ type: 'change-set', changes: 'objects' }] },
      { type: 'engine-commands', commands: [{ type: 'overlay' }] },
      { type: 'engine-commands', commands: [{ type: 'grid', isVisible: 'yes' }] },
      {
        type: 'engine-commands',
        commands: [{ type: 'pointer', input: { ...CAMERA, type: 'hover' } }],
      },
    ]) {
      expect(isHostToWorkerMessage(message), JSON.stringify(message)).toBe(false);
    }
  });
});

describe('isWorkerToHostMessage', () => {
  it('accepts every message the worker sends', () => {
    for (const message of [
      { type: 'engine-ready', capabilities: {}, timeOriginMs: 5 },
      { type: 'engine-frame', report: {} },
      { type: 'engine-pixels', id: 1, pixels: {} },
      { type: 'engine-frame-stats', id: 2, sample: {} },
      { type: 'engine-failure', failure: { name: 'Error', message: 'x' } },
      { type: 'engine-failure', id: 2, failure: { name: 'Error', message: 'x' } },
      { type: 'engine-needs-canvas' },
      { type: 'engine-needs-frame-tick' },
      { type: 'engine-backend-changed', capabilities: {} },
    ]) {
      expect(isWorkerToHostMessage(message), JSON.stringify(message)).toBe(true);
    }
  });

  it('rejects malformed messages', () => {
    for (const message of [
      undefined,
      { type: 'engine-ready', capabilities: {} },
      { type: 'engine-pixels', pixels: {} },
      { type: 'engine-frame-stats', id: 2 },
      { type: 'engine-failure', failure: { name: 'Error' } },
      { type: 'engine-failure', id: 'one', failure: { name: 'Error', message: 'x' } },
      { type: 'job-result', id: 1, payload: {} },
      { type: 'engine-backend-changed' },
    ]) {
      expect(isWorkerToHostMessage(message), JSON.stringify(message)).toBe(false);
    }
  });
});

describe('host failures', () => {
  it('survive the trip as a name and a message', () => {
    const failure = describeHostFailure(new RangeError('outside'));
    expect(failure).toEqual({ name: 'RangeError', message: 'outside' });
    const error = toHostError(failure);
    expect([error.name, error.message]).toEqual(['RangeError', 'outside']);
    expect(describeHostFailure('plain')).toEqual({ name: 'Error', message: 'plain' });
  });
});
