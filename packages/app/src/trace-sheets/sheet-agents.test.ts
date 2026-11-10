import { describe, expect, it } from 'vitest';

import type { PrincipalId } from '@canvas/schema';

import type { CollaboratorSummary } from '../collab/board-connection-status.js';

import { followSheetAgents, NO_SHEET_AGENTS, sheetPresenceKey } from './sheet-agents.js';

const ATLAS_ID = 'agent:atlas' as PrincipalId;
const SHEETS = [{ agentId: ATLAS_ID }];

/**
 * An agent as presence shows it.
 *
 * @param name - Its name.
 * @param principalId - Its bare id.
 * @returns The collaborator.
 */
function agent(name: string, principalId = 'atlas'): CollaboratorSummary {
  return { principalId, kind: 'agent', name, color: '#9db4c4' };
}

describe('followSheetAgents', () => {
  it('remembers an open sheet’s agent presence shows, working', () => {
    const agents = followSheetAgents(NO_SHEET_AGENTS, SHEETS, [agent('Atlas')]);
    expect([...agents]).toEqual([[ATLAS_ID, { name: 'Atlas', isStopped: false }]]);
  });

  it('marks it stopped, under the name it had, when it leaves presence', () => {
    const working = followSheetAgents(NO_SHEET_AGENTS, SHEETS, [agent('Atlas')]);
    const stopped = followSheetAgents(working, SHEETS, []);
    expect(stopped.get(ATLAS_ID)).toEqual({ name: 'Atlas', isStopped: true });
    expect(followSheetAgents(stopped, SHEETS, [])).toBe(stopped);
  });

  it('has it working again when it comes back, with the name presence gives now', () => {
    const working = followSheetAgents(NO_SHEET_AGENTS, SHEETS, [agent('Atlas')]);
    const stopped = followSheetAgents(working, SHEETS, []);
    const back = followSheetAgents(stopped, SHEETS, [agent('Atlas 2')]);
    expect(back.get(ATLAS_ID)).toEqual({ name: 'Atlas 2', isStopped: false });
  });

  it('never takes an agent presence has not shown for stopped', () => {
    // An MCP agent without presence, or a sheet that opened before the agent's presence came.
    expect(followSheetAgents(NO_SHEET_AGENTS, SHEETS, [])).toBe(NO_SHEET_AGENTS);
    const person: CollaboratorSummary = { ...agent('Atlas'), kind: 'user' };
    const other = agent('Bea', 'bea');
    expect(followSheetAgents(NO_SHEET_AGENTS, SHEETS, [person, other])).toBe(NO_SHEET_AGENTS);
  });

  it('keeps an absent agent as it was until presence has settled', () => {
    const working = followSheetAgents(NO_SHEET_AGENTS, SHEETS, [agent('Atlas')]);
    expect(followSheetAgents(working, SHEETS, [], false)).toBe(working);
    const stopped = followSheetAgents(working, SHEETS, []);
    expect(followSheetAgents(stopped, SHEETS, [], false)).toBe(stopped);
    expect(followSheetAgents(stopped, SHEETS, [agent('Atlas')], false).get(ATLAS_ID)).toEqual({
      name: 'Atlas',
      isStopped: false,
    });
  });

  it('forgets the agent of a closed sheet, and changes nothing when nothing changed', () => {
    const working = followSheetAgents(NO_SHEET_AGENTS, SHEETS, [agent('Atlas')]);
    expect(followSheetAgents(working, SHEETS, [agent('Atlas')])).toBe(working);
    expect(followSheetAgents(working, [], [agent('Atlas')]).size).toBe(0);
  });
});

describe('sheetPresenceKey', () => {
  it('names each open sheet’s agent with its presence name, and changes with nothing else', () => {
    const scout = { agentId: 'agent:scout' as PrincipalId };
    const bea: CollaboratorSummary = { ...agent('Bea', 'bea'), kind: 'user' };
    const key = sheetPresenceKey([...SHEETS, scout], [agent('Atlas'), bea]);
    expect(key).toBe('agent:atlas=Atlas\nagent:scout');
    expect(sheetPresenceKey([...SHEETS, scout], [{ ...agent('Atlas'), color: '#000000' }])).toBe(
      key,
    );
    expect(sheetPresenceKey(SHEETS, [])).toBe('agent:atlas');
  });
});
