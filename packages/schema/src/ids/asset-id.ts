import { z } from 'zod';

/**
 * Validates an asset id: an opaque string of 1 to 128 letters, digits, `_` or `-` naming an
 * image, video or font in object storage. Asset bytes never live in
 * the document; only this id does.
 */
export const assetIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, 'an asset id is 1 to 128 letters, digits, "_" or "-"')
  .brand<'AssetId'>()
  .describe('Opaque id of an asset in object storage: 1 to 128 of [A-Za-z0-9_-].');

/** The id of an asset (image, video, poster frame) that an object references. Branded. */
export type AssetId = z.output<typeof assetIdSchema>;
