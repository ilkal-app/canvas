import { z } from 'zod';

const boardId = z.string().min(1).max(256);
const batchId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const decimal = z.string().regex(/^(0|[1-9][0-9]{0,38})$/u);
const capability = z.literal('atomic-batch-v1');

/** Strict metadata; authority identities appear only in the server's welcome. */
export const atomicHeaderSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    /** Message discriminator; determines permitted metadata and payload. */
    kind: z.literal('hello'),
    /** Authenticated board routing key. */
    boardId,
    /** Required atomic-batch-v1 capability; no legacy mutation fallback. */
    capability,
  }),
  z.strictObject({
    /** Message discriminator; determines permitted metadata and payload. */
    kind: z.literal('welcome'),
    /** Authenticated board routing key. */
    boardId,
    /** Required atomic-batch-v1 capability; no legacy mutation fallback. */
    capability,
    /** Server-issued immutable connection identity. */
    connectionSessionId: batchId,
    /** Server ownership generation encoded as a decimal string. */
    ownershipEpoch: decimal,
  }),
  z.strictObject({
    /** Message discriminator; determines permitted metadata and payload. */
    kind: z.literal('begin'),
    /** Authenticated board routing key. */
    boardId,
    /** Batch identifier scoped to the authenticated server session. */
    batchId,
    /** Number of ordered original update parts, at most 256. */
    partCount: z.number().int().min(1).max(256),
    /** Exact aggregate original payload bytes, at most 64 MiB. */
    totalBytes: z
      .number()
      .int()
      .min(1)
      .max(64 * 1024 * 1024),
    /** Lowercase SHA-256 of domain-separated original part lengths and bytes. */
    digest: z.string().regex(/^[0-9a-f]{64}$/u),
  }),
  z.strictObject({
    /** Message discriminator; determines permitted metadata and payload. */
    kind: z.literal('part'),
    /** Authenticated board routing key. */
    boardId,
    /** Batch identifier scoped to the authenticated server session. */
    batchId,
    /** Zero-based original part index; staging does not acknowledge publication. */
    index: z.number().int().min(0).max(255),
  }),
  z.strictObject({
    /** Message discriminator; determines permitted metadata and payload. */
    kind: z.literal('part-staged'),
    /** Authenticated board routing key. */
    boardId,
    /** Batch identifier scoped to the authenticated server session. */
    batchId,
    /** Zero-based original part index; staging does not acknowledge publication. */
    index: z.number().int().min(0).max(255),
  }),
  z.strictObject({
    /** Message discriminator; determines permitted metadata and payload. */
    kind: z.literal('commit'),
    /** Authenticated board routing key. */
    boardId,
    /** Batch identifier scoped to the authenticated server session. */
    batchId,
  }),
  z.strictObject({
    /** Message discriminator; determines permitted metadata and payload. */
    kind: z.literal('receipt'),
    /** Authenticated board routing key. */
    boardId,
    /** Batch identifier scoped to the authenticated server session. */
    batchId,
    /** Durably committed cursor after canonical publication, encoded as decimal. */
    commitCursor: decimal,
  }),
  z.strictObject({
    /** Message discriminator; determines permitted metadata and payload. */
    kind: z.literal('refusal'),
    /** Authenticated board routing key. */
    boardId,
    /** Fixed protocol refusal category without document content. */
    reason: z.enum(['reload-required', 'read-only', 'invalid-batch', 'resync-required', 'busy']),
  }),
]);

/** Version-one atomic transport metadata, shared by browser and relay. */
export type AtomicHeader = z.infer<typeof atomicHeaderSchema>;
