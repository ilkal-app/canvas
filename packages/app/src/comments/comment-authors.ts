import type { Message } from './comment-api.js';

/**
 * A stable key for a message's author, for its avatar's colour and to tell authors apart: a
 * person's user id, a guest's name, or for an agent (no user id) its name and
 * operator.
 *
 * @param message - The message.
 * @returns The key.
 */
export function authorKeyOf(message: Message): string {
  if (message.authorId !== null) return message.authorId;
  // A guest's message carries its name, not its id.
  if (message.authorKind === 'guest') return `guest:${message.authorName}`;
  return `agent:${message.operatorId ?? ''}:${message.authorName}`;
}

/**
 * Whether a person may delete a message: their own, or one their own agent wrote for
 * them. Never anyone else's; the boards service refuses those too.
 *
 * @param message - The message.
 * @param userId - The person.
 * @returns True when they may.
 */
export function isDeletableBy(message: Message, userId: string): boolean {
  return (
    message.authorId === userId || (message.authorKind === 'agent' && message.operatorId === userId)
  );
}
