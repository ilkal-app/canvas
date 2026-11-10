import { describe, expect, it, vi } from 'vitest';

import { createObjectsCommand, deleteObjectsCommand, runCommand } from '@canvas/document';

import { ADA_ORIGIN, createAgentBoard } from './__fixtures__/agent-board.js';
import { TraceSheetTracker } from './trace-sheet-tracker.js';

const ENVIRONMENT = { clock: () => 1_770_000_000_000, createId: () => 'unused' as never };

describe('TraceSheetTracker', () => {
  it('puts nothing on a sheet before it is armed: the board as the person opened it', () => {
    const board = createAgentBoard();
    const tracker = new TraceSheetTracker(board.person);
    board.agentCreates([0, 200]);
    expect(tracker.sheets()).toEqual([]);
  });

  it('opens a sheet for an agent with the objects it creates from then on', () => {
    const board = createAgentBoard();
    const tracker = new TraceSheetTracker(board.person);
    board.agentCreates([0]);
    tracker.arm();
    const first = board.agentCreates([200, 400]);
    const second = board.agentCreates([600]);
    // Within one change set the ids come sorted; change sets keep their order.
    expect(tracker.sheets()).toEqual([
      { agentId: 'agent:atlas', memberIds: [...[...first].sort(), ...second] },
    ]);
  });

  it('keeps one sheet per agent, in the order they opened', () => {
    const board = createAgentBoard();
    const tracker = new TraceSheetTracker(board.person);
    tracker.arm();
    const atlas = board.agentCreates([0]);
    const scout = board.agentCreates([200], 'scout');
    expect(tracker.sheets()).toEqual([
      { agentId: 'agent:atlas', memberIds: atlas },
      { agentId: 'agent:scout', memberIds: scout },
    ]);
  });

  it('never puts the person’s own objects on a sheet', () => {
    const board = createAgentBoard();
    const tracker = new TraceSheetTracker(board.person);
    tracker.arm();
    const objects = [{ type: 'group' as const, x: 0, y: 0 }];
    runCommand(
      board.person,
      ADA_ORIGIN,
      createObjectsCommand,
      { objects },
      {
        clock: ENVIRONMENT.clock,
        createId: () => 'ada-group' as never,
      },
    );
    expect(tracker.sheets()).toEqual([]);
  });

  it('drops deleted members, closes a sheet left empty, and closes on request', () => {
    const board = createAgentBoard();
    const tracker = new TraceSheetTracker(board.person);
    tracker.arm();
    const [one, two] = board.agentCreates([0, 200]);
    runCommand(board.person, ADA_ORIGIN, deleteObjectsCommand, { ids: [one ?? ''] }, ENVIRONMENT);
    expect(tracker.sheets()).toEqual([{ agentId: 'agent:atlas', memberIds: [two] }]);
    runCommand(board.person, ADA_ORIGIN, deleteObjectsCommand, { ids: [two ?? ''] }, ENVIRONMENT);
    expect(tracker.sheets()).toEqual([]);

    board.agentCreates([400]);
    expect(tracker.sheets()).toHaveLength(1);
    tracker.close('agent:atlas' as never);
    expect(tracker.sheets()).toEqual([]);
    // The agent's next object opens a new sheet, holding only what came after.
    const later = board.agentCreates([600]);
    expect(tracker.sheets()).toEqual([{ agentId: 'agent:atlas', memberIds: later }]);
  });

  it('tells its listeners when a member changes, keeping the same sheets', () => {
    const board = createAgentBoard();
    const tracker = new TraceSheetTracker(board.person);
    tracker.arm();
    const [one] = board.agentCreates([0]);
    const before = tracker.sheets();
    const listener = vi.fn();
    const stop = tracker.subscribe(listener);
    board.personMoves(one ?? ('' as never));
    expect(listener).toHaveBeenCalledOnce();
    expect(tracker.sheets()).toBe(before);
    stop();
    tracker.destroy();
    board.agentCreates([200]);
    expect(tracker.sheets()).toBe(before);
  });
});
