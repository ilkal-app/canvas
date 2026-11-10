import { z } from 'zod';

/**
 * Validates a principal id: `user:<id>` for a person, `agent:<id>` for an agent (agents
 * have their own principal type), `guest:<id>` for a person with no account
 * who joined one board by its link, `demo:<id>` for a visitor to the public demo board,
 * whose connection is read-only, so it names only a local command origin and never a
 * creator the relay accepts, or `system` for objects the product creates itself. The `<id>` part
 * is opaque and has no whitespace. `undo` is a command origin, never a creator, so it is rejected.
 */
export const principalIdSchema = z
  .string()
  .regex(
    /^(?:(?:user|agent|guest|demo):\S{1,128}|system)$/,
    'a principal is "user:<id>", "agent:<id>", "guest:<id>", "demo:<id>" or "system"',
  )
  .brand<'PrincipalId'>()
  .describe(
    'Who created the object: "user:<id>", "agent:<id>", "guest:<id>", "demo:<id>" or "system".',
  );

/** The principal that created an object, as it appears in a command origin. Branded. */
export type PrincipalId = z.output<typeof principalIdSchema>;
