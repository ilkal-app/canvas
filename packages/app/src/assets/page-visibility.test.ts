import { describe, expect, it } from 'vitest';

import { documentVisibility } from './page-visibility.js';

/** A document whose visibility a test sets. */
class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

describe('documentVisibility', () => {
  it('reads the document’s visibility and hears each change until stopped', () => {
    const target = new FakeDocument();
    const visibility = documentVisibility(target as unknown as Document);
    let changes = 0;
    const stop = visibility?.listen(() => (changes += 1));
    expect(visibility?.isHidden()).toBe(false);
    target.visibilityState = 'hidden';
    target.dispatchEvent(new Event('visibilitychange'));
    expect(visibility?.isHidden()).toBe(true);
    stop?.();
    target.dispatchEvent(new Event('visibilitychange'));
    expect(changes).toBe(1);
  });

  it('is undefined without a document', () => {
    expect(documentVisibility(undefined)).toBeUndefined();
  });
});
