import type { LiftOffOutcome } from '@canvas/document';

/**
 * What the shell tells the person after Lift off: how many objects went, and how many
 * stayed because someone changed them since the agent made them (the rule); nothing when
 * every object went. Pure.
 *
 * @param outcome - What `liftOff` did.
 * @param name - The agent's name.
 * @returns The sentence, or undefined when there is nothing to say.
 */
export function liftOffNotice(outcome: LiftOffOutcome, name: string): string | undefined {
  const kept = outcome.keptIds.length;
  if (outcome.status === 'rejected') return `Could not lift off ${name}’s sheet.`;
  if (kept === 0) return undefined;
  const them = kept === 1 ? 'Kept 1 object' : `Kept ${String(kept)} objects`;
  const since = 'someone has changed since';
  if (outcome.status === 'nothing') return `Nothing lifted off: ${them.toLowerCase()} ${since}.`;
  const lifted = outcome.liftedIds.length;
  const objects = lifted === 1 ? '1 object' : `${String(lifted)} objects`;
  return `Lifted off ${objects}. ${them} ${since}.`;
}
