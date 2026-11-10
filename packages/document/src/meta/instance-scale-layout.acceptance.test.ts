import { describe, expect, it } from 'vitest';

import * as document from '../index.js';

describe('instance scale stored layout', () => {
  it('advances the document layout and keeps the preceding layout readable', () => {
    const version = Reflect.get(document, 'INSTANCE_SCALE_LAYOUT_VERSION') as number | undefined;
    if (version === undefined) throw new Error('missing export: INSTANCE_SCALE_LAYOUT_VERSION');
    expect(Number.isInteger(version)).toBe(true);
    expect(document.DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(version);
    expect(document.READABLE_LAYOUT_VERSIONS).toContain(version);
    expect(document.READABLE_LAYOUT_VERSIONS).toContain(version - 1);
    expect(version).toBeGreaterThan(document.FRAME_RADIUS_LAYOUT_VERSION);
  });
});
