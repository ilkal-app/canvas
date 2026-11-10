import { z } from 'zod';

/** Owner-approved optional scalar slot; author and authority remain authenticated relay context. */
export const RESTORE_MARKER_KEY = 'lastRestore';

/** A unique operation id shared by all object transactions of one restoration. */
export const restoreMarkerSchema = z
  .strictObject({
    /** Restore-intent format version, independent of board layout and schema versions. */
    version: z.literal(1),
    /** UUID shared by all transaction parts of one restoration. */
    id: z.uuid(),
    /** Zero-based transaction part within the restoration. */
    part: z.number().int().nonnegative(),
    /** Total number of transaction parts in the restoration. */
    parts: z.number().int().positive(),
  })
  .refine((value) => value.part < value.parts);

/** One count-bounded part of explicit restore intent; it grants no access. */
export type RestoreMarker = z.output<typeof restoreMarkerSchema>;
