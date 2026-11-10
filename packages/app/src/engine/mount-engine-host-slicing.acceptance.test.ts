// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId, PrincipalId } from '@canvas/schema';

import { mountOnFakeHost } from './__fixtures__/fake-engine-host.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('mounts the visible objects to the host before posting the rest of a large board', async () => {
  const board: BoardObject[] = [];
  for (let index = 0; index < 2_001; index += 1) {
    board.push({
      id: `shape-${String(index)}` as ObjectId,
      type: 'shape',
      parentId: null,
      x: index === 2_000 ? 10 : 1_000 + index * 20,
      y: 10,
      rotation: 0,
      z: 'a0',
      locked: false,
      createdBy: 'user:acceptance' as PrincipalId,
      createdAt: 1,
      updatedAt: 1,
      width: 10,
      height: 10,
      kind: 'rectangle',
      cornerRadius: 0,
      sides: 4,
      label: null,
      stroke: null,
      fill: [1, 0, 0, 1],
    });
  }
  const { host, engine } = await mountOnFakeHost({ options: { board } });
  const first = host.changeSets[0];
  expect(first?.created).toEqual([board[2_000]?.id]);
  expect(first?.updated).toEqual([]);
  expect(first?.deleted).toEqual([]);
  await vi.runAllTimersAsync();
  expect(new Set(host.changeSets.flatMap((changes) => changes.created))).toEqual(
    new Set(board.map((object) => object.id)),
  );
  expect(host.changeSets.length).toBeGreaterThan(1);
  engine.destroy();
});
