import type { PrincipalId } from '@canvas/schema';

import type { CollaboratorSummary } from '../collab/board-connection-status.js';

/**
 * The name a sheet shows for its agent: its presence name (the agent's board token's
 * display name, which an agent's presence carries), when the agent is on the board; else the
 * name presence last gave it, when known (a stopped agent keeps its name); else its id
 * without the `agent:` prefix, as the document records it. Pure.
 *
 * @param agentId - The agent, `agent:<id>`.
 * @param collaborators - Who is on the board, as presence shows them.
 * @param remembered - The name presence last gave the agent, if any.
 * @returns The name.
 */
export function agentNameOf(
  agentId: PrincipalId,
  collaborators: readonly CollaboratorSummary[],
  remembered?: string,
): string {
  const id = agentId.slice('agent:'.length);
  const present = collaborators.find(
    (collaborator) => collaborator.kind === 'agent' && collaborator.principalId === id,
  );
  return present?.name ?? remembered ?? id;
}
