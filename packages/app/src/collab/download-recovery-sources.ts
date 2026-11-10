import type { CacheRecovery } from '@canvas/collab';

/** The read-only source used by the recovery download. */
export type RecoveryExportSource = Pick<CacheRecovery, 'exportSources'>;

/**
 * Downloads original retained bytes as a versioned JSON recovery copy. This never retires
 * device records and does not claim the file can be imported as an ordinary board.
 *
 * @param source - The retained records to export.
 * @param boardId - The board these records belong to.
 */
export async function downloadRecoverySources(
  source: RecoveryExportSource,
  boardId: string,
): Promise<void> {
  const sources = await source.exportSources();
  const json = JSON.stringify(
    { format: 'canvas-recovery-v1', boardId, sources },
    (...[, value]: [string, unknown]) => {
      return value instanceof Uint8Array ? { encoding: 'byte-array', bytes: [...value] } : value;
    },
  );
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'canvas-recovery.json';
  try {
    link.click();
  } finally {
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  }
}
