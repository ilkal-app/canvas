import type { AssetCatalogue } from './asset-catalogue.js';
import type { Want } from './image-needs.js';
import { imagePreviewOf } from './image-preview-registry.js';
import type { TextureManagerParts } from './texture-manager-parts.js';

/**
 * Asks the loader for the levels a plan wants and no longer for those it does not: a level
 * resident, queued for upload or held by the catalogue needs no load; a new one may come through
 * the manager's preview tracker first. Then the loader runs its queue.
 *
 * @param manager - The texture manager, whose preview tracker (if any) admits and cancels loads.
 * @param parts - Its loader, residency and uploads.
 * @param catalogue - The CPU copies of the smallest levels.
 * @param wants - What the plan wants resident, by key.
 */
export function requestLevelLoads(
  manager: object,
  parts: Pick<TextureManagerParts, 'loader' | 'residency' | 'uploads'>,
  catalogue: AssetCatalogue,
  wants: ReadonlyMap<string, Want>,
): void {
  for (const key of [...parts.loader.keys()]) {
    if (!wants.has(key)) {
      parts.loader.cancel(key);
      imagePreviewOf(manager)?.cancel(key);
    }
  }
  for (const [key, want] of wants) {
    if (parts.residency.get(key) !== undefined || parts.uploads.has(key)) continue;
    if (catalogue.smallestOf(want.source) !== undefined) continue;
    const source = parts.loader.has(key)
      ? want.source
      : (imagePreviewOf(manager)?.admit(key, want.source) ?? want.source);
    parts.loader.request(key, source, want.priority);
  }
  parts.loader.pump();
}
