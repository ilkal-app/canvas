import { describe, expect, it } from 'vitest';

import { createLinkCard, YjsDocumentStore, type CommandEnvironment } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { LOCAL_USER_ORIGIN } from './demo-document.js';
import { linkCardWritesOf } from './link-card-writes.js';

const ENVIRONMENT: CommandEnvironment = { clock: () => 1, createId: () => 'card' as ObjectId };

describe('linkCardWritesOf', () => {
  it('writes a pasted card’s preview, and puts a failed one back to pending', () => {
    const store = new YjsDocumentStore({ clientId: 725 });
    const id = createLinkCard(
      store,
      { url: 'https://example.com/', x: 0, y: 0, unfurlKey: 'k' },
      LOCAL_USER_ORIGIN,
      ENVIRONMENT,
    );
    const writes = linkCardWritesOf({ store, origin: LOCAL_USER_ORIGIN, environment: ENVIRONMENT });
    expect(writes.retryLinkUnfurl?.(id, 'k2')).toBe(false);
    expect(writes.applyLinkUnfurl?.(id, { unfurlKey: 'k', outcome: { status: 'failed' } })).toBe(
      true,
    );
    expect(writes.retryLinkUnfurl?.(id, 'k2')).toBe(true);
    expect(store.get(id)).toMatchObject({ status: 'pending', unfurlKey: 'k2' });
  });
});
