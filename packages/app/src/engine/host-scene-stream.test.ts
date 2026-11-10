import { expect, it, vi } from 'vitest';

import type { EngineHost, SceneStamp } from '@canvas/engine';

import { enqueueHostScene, readHostSceneStamp } from './host-scene-stream.js';

it('isolates host lifetimes and owns stamps across delayed reads and transport callbacks', () => {
  const applyChangeSet = vi.fn((changes: unknown, stamp: SceneStamp) => {
    Object.assign(stamp, { sequence: 99 });
  });
  const first = { applyChangeSet } as unknown as EngineHost;
  const second = { applyChangeSet: vi.fn() } as unknown as EngineHost;
  const changes = { created: [], updated: [], deleted: [], objects: {} };
  expect(readHostSceneStamp(first)).toBeUndefined();
  const a = enqueueHostScene(first, changes);
  expect(a.sequence).toBe(0);
  const b = enqueueHostScene(second, changes);
  expect(b.session).not.toBe(a.session);
  expect(b.sequence).toBe(0);
  const captured = readHostSceneStamp(first);
  if (captured === undefined) throw new Error('Missing stream.');
  Object.assign(captured, { sequence: 100 });
  expect(enqueueHostScene(first, changes)).toEqual({ ...a, sequence: 1 });
});
