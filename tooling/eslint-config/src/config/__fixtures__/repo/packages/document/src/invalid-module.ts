import { version as reactVersion } from 'react';

import { clampZoom } from '@canvas/engine';
import { SCHEMA_VERSION } from '@canvas/schema/src/version/schema-version';

import { SCHEMA_NAME } from '../../schema/src/name/schema-name.js';

export function describeDocument(zoom: number): string {
  return `${SCHEMA_NAME} schema ${String(SCHEMA_VERSION)}, zoom ${String(clampZoom(zoom))}, react ${String(reactVersion)}`;
}

/**
 * Reads the zoom factor a document opens at.
 *
 * @param zoom - The stored zoom factor.
 * @returns The zoom factor, unchanged.
 */
export function readOpeningZoom(zoom: number): number {
  if (zoom <= 0) {
    throw new RangeError('A zoom factor is positive.');
  }
  return zoom;
}
