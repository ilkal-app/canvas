import type { PrincipalId } from '@canvas/schema';

import type { CollaboratorSummary } from '../collab/board-connection-status.js';

/** What a sheet's tab remembers of its agent from presence. */
export interface SheetAgent {
  /** The agent's presence name, as last seen. */
  readonly name: string;
  /** Whether the agent left presence while its sheet was open: it stopped before it was done. */
  readonly isStopped: boolean;
}

/** The agents of the open sheets that presence has shown, by agent (`agent:<id>`). */
export type SheetAgents = ReadonlyMap<PrincipalId, SheetAgent>;

/**
 * How long after the person's connection comes up presence has to repopulate before an absent
 * agent is taken for stopped, ms. Connecting clears every remote presence (the
 * collab client's `RelayLink.close`), and the relay sends the present clients' states once it
 * admits the connection, a round trip later and possibly after the document sync that makes the
 * person `connected`; 2 s bounds that on a slow link, far under the 15 s y-protocols renewal.
 */
export const PRESENCE_SETTLE_MS = 2000;

/** No agent seen yet. */
export const NO_SHEET_AGENTS: SheetAgents = new Map();

/**
 * The agent of a sheet as presence shows it now, if it is on the board.
 *
 * @param agentId - The agent, `agent:<id>`.
 * @param collaborators - Who is on the board.
 * @returns The agent's collaborator entry, or undefined.
 */
function presentAgent(
  agentId: PrincipalId,
  collaborators: readonly CollaboratorSummary[],
): CollaboratorSummary | undefined {
  const id = agentId.slice('agent:'.length);
  return collaborators.find(
    (collaborator) => collaborator.kind === 'agent' && collaborator.principalId === id,
  );
}

/**
 * What presence shows of the open sheets' agents, as one string: each agent with its presence
 * name, or none. It changes only when {@link followSheetAgents} could answer differently, so a
 * hook can follow the agents on it rather than on every change of presence (cursors move many
 * times a second). Pure.
 *
 * @param sheets - The open sheets' agents.
 * @param collaborators - Who is on the board now.
 * @returns The key.
 */
export function sheetPresenceKey(
  sheets: readonly { readonly agentId: PrincipalId }[],
  collaborators: readonly CollaboratorSummary[],
): string {
  return sheets
    .map(({ agentId }) => {
      const present = presentAgent(agentId, collaborators);
      return present === undefined ? agentId : `${agentId}=${present.name}`;
    })
    .join('\n');
}

/**
 * Follows the agents of the open sheets in presence: an agent presence
 * shows while its sheet is open is remembered with its name; one that then leaves presence
 * (its connection was lost) is stopped, under the name it had; one that comes back is working
 * again. An agent presence has never shown (its sheet opened before its presence arrived, or it
 * has none) is not remembered, so it is never taken for stopped. A closed sheet's agent is
 * forgotten. Judge only while the person's own connection is up: without it, presence says
 * nothing about the agent; and until presence has settled after it came up (`canStop` false,
 * {@link PRESENCE_SETTLE_MS}), an absent agent keeps what it was, so the person's own reconnect
 * never reads as the agents stopping. Pure.
 *
 * @param previous - What was remembered.
 * @param sheets - The open sheets' agents.
 * @param collaborators - Who is on the board now, as presence shows them.
 * @param canStop - Whether presence has settled, so an absent agent may be taken for stopped.
 * @returns What to remember: `previous` itself when nothing changed.
 */
export function followSheetAgents(
  previous: SheetAgents,
  sheets: readonly { readonly agentId: PrincipalId }[],
  collaborators: readonly CollaboratorSummary[],
  canStop = true,
): SheetAgents {
  const next = new Map<PrincipalId, SheetAgent>();
  for (const { agentId } of sheets) {
    const present = presentAgent(agentId, collaborators);
    const known = previous.get(agentId);
    if (present !== undefined) {
      const isSame = known?.name === present.name && !known.isStopped;
      next.set(agentId, isSame ? known : { name: present.name, isStopped: false });
    } else if (known !== undefined) {
      next.set(
        agentId,
        known.isStopped || !canStop ? known : { name: known.name, isStopped: true },
      );
    }
  }
  const isUnchanged =
    next.size === previous.size &&
    [...next].every(([agentId, agent]) => previous.get(agentId) === agent);
  return isUnchanged ? previous : next;
}
